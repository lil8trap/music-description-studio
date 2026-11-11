import logging
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import imageio_ffmpeg
import librosa
import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Music Description AI API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
MAX_BYTES = 100 * 1024 * 1024
MAX_DURATION = 600
ANALYSIS_SECONDS = 60
logger = logging.getLogger(__name__)


def tempo_interpretations(y, sr):
    """Estimate pulse and compare metrical levels using onset autocorrelation.

    Scores reflect onset repetition at candidate beat intervals, sampled across
    the analyzed audio. They are not calibrated probabilities, and octave
    ambiguity cannot be resolved reliably for every song.
    """
    hop_length = 512
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    raw, _ = librosa.beat.beat_track(onset_envelope=onset, sr=sr, hop_length=hop_length)
    base = float(np.asarray(raw).reshape(-1)[0])
    if not np.isfinite(base) or base <= 0 or len(onset) < 16:
        return {"detected": None, "half_time": None, "double_time": None,
                "suggested": None, "confidence": "unavailable", "candidate_scores": {},
                "suggestion_reason": "Insufficient rhythmic evidence to estimate a beat."}

    bpm_candidates = {"half_time": base / 2, "detected": base, "double_time": base * 2}
    # Three equal subdivisions capture changes in the rhythm. A segment with
    # almost no onsets is intentionally excluded from the scoring.
    windows = np.array_split(onset, 3)
    scores = {}
    for label, bpm in bpm_candidates.items():
        lag = int(round(60.0 * sr / (hop_length * bpm)))
        segment_scores = []
        for window in windows:
            if lag < 2 or len(window) <= lag + 4:
                continue
            centered = window.astype(np.float64) - float(np.mean(window))
            if float(np.std(centered)) < 1e-7:
                continue
            a, b = centered[:-lag], centered[lag:]
            denom = float(np.linalg.norm(a) * np.linalg.norm(b))
            if denom > 1e-10:
                segment_scores.append(float(np.dot(a, b) / denom))
        scores[label] = max(0.0, float(np.median(segment_scores))) if segment_scores else 0.0

    # Use periodicity evidence first, not an arbitrary BPM cutoff. Closely
    # matched scores indicate a genuine half/double ambiguity.
    ranking = sorted(scores, key=lambda k: scores[k], reverse=True)
    winner = ranking[0]
    gap = scores[ranking[0]] - scores[ranking[1]]
    quality = scores[winner]
    ambiguous = quality < 0.12 or gap < 0.06
    return {
        "detected": round(base, 1),
        "half_time": round(base / 2, 1),
        "double_time": round(base * 2, 1),
        "suggested": round(bpm_candidates[winner], 1),
        "confidence": "ambiguous" if ambiguous else "moderate",
        "candidate_scores": {key: round(value, 3) for key, value in scores.items()},
        "suggestion_reason": (
            "Several metrical levels have similar or weak onset evidence; verify by ear."
            if ambiguous else
            "Highest onset-periodicity match across three sections of the analyzed audio."
        ),
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


def convert_to_wav(source: str, target: str, sample_rate: int) -> None:
    """Use the bundled FFmpeg binary to decode MP3/WAV consistently on macOS."""
    try:
        executable = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        logger.exception("Bundled FFmpeg executable is unavailable")
        raise HTTPException(503, "Audio decoder is unavailable. Install the backend dependencies.") from exc
    try:
        completed = subprocess.run(
            [executable, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
             "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn",
             "-t", str(MAX_DURATION + 1), "-ac", "1", "-ar", str(sample_rate),
             "-c:a", "pcm_s16le", target],
            capture_output=True, timeout=120, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        logger.exception("FFmpeg timed out decoding the upload")
        raise HTTPException(503, "Audio decoding timed out.") from exc
    if completed.returncode != 0:
        logger.warning("FFmpeg could not decode the upload: %s", completed.stderr[-1200:].decode(errors="replace"))
        raise HTTPException(400, "This MP3 or WAV file could not be decoded.")


@asynccontextmanager
async def decoded_upload(audio: UploadFile, sample_rate: int):
    """Limit upload size, normalize its audio, and remove both temporary files."""
    paths = []
    try:
        suffix = Path(audio.filename or "").suffix.lower()
        if suffix not in {".mp3", ".wav"}:
            raise HTTPException(400, "Please upload an MP3 or WAV file.")
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as source:
            paths.append(source.name)
            total = 0
            while chunk := await audio.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, "Maximum file size is 100 MB.")
                source.write(chunk)
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as decoded:
            paths.append(decoded.name)
        await run_in_threadpool(convert_to_wav, paths[0], paths[1], sample_rate)
        try:
            info = await run_in_threadpool(sf.info, paths[1])
            duration = info.frames / info.samplerate
        except Exception as exc:
            logger.exception("FFmpeg output could not be read as PCM WAV")
            raise HTTPException(503, "Decoded audio could not be read. Check run-logs/python.log.") from exc
        if not 1 <= duration <= MAX_DURATION:
            raise HTTPException(400, "Song must be between 1 second and 10 minutes.")
        yield paths[1], duration
    finally:
        await audio.close()
        for path in paths:
            Path(path).unlink(missing_ok=True)


def analyze_decoded(path: str, duration: float) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True, duration=ANALYSIS_SECONDS)
    if not len(y):
        raise ValueError("The decoded audio has no samples")
    try:
        tempo_info = tempo_interpretations(y, sr)
    except Exception:
        logger.exception("Beat tracking failed; returning the remaining audio features")
        tempo_info = {"detected": None, "half_time": None, "double_time": None,
                      "suggested": None, "confidence": "unavailable", "candidate_scores": {},
                      "suggestion_reason": "Beat tracking failed; see run-logs/python.log."}
    # Read the normalized PCM file once for the full-song peak envelope.
    full_audio, _ = sf.read(path, dtype="float32", always_2d=False)
    waveform = [round(float(np.max(np.abs(chunk))), 4) if len(chunk) else 0.0
                for chunk in np.array_split(full_audio, 650)]
    return {
        "tempo": tempo_info["detected"],
        "tempo_interpretations": tempo_info,
        "energy": round(float(np.mean(librosa.feature.rms(y=y))), 4),
        "brightness": round(float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr))), 1),
        "zcr": round(float(np.mean(librosa.feature.zero_crossing_rate(y))), 4),
        "duration": round(duration, 1),
        "analyzed_length": round(len(y) / sr, 1),
        "waveform": waveform,
        "waveform_duration": round(duration, 1),
        "description": None,
        "description_status": "available_via_description_endpoint",
    }


@app.post("/api/analyze")
async def analyze(audio: UploadFile = File(...)):
    async with decoded_upload(audio, 22050) as (path, duration):
        try:
            return await run_in_threadpool(analyze_decoded, path, duration)
        except Exception as exc:
            logger.exception("Audio decoded but feature extraction failed")
            raise HTTPException(503, "Audio decoded, but feature analysis failed. Check run-logs/python.log.") from exc


@app.post("/api/description")
async def description(audio: UploadFile = File(...)):
    """Analyze a short excerpt of an uploaded song with a zero-shot audio model."""
    from mood import estimate_mood
    async with decoded_upload(audio, 48000) as (path, _):
        try:
            return await run_in_threadpool(estimate_mood, path)
        except Exception as exc:
            logger.exception("Music description analysis failed")
            raise HTTPException(503, "Description model could not analyze this song. Check run-logs/python.log.") from exc


@app.post("/api/timeline")
async def timeline(audio: UploadFile = File(...)):
    """Compare eight short excerpts distributed across the whole track.

    This is a sampled description timeline, not continuous frame-by-frame analysis.
    """
    from mood import estimate_timeline
    async with decoded_upload(audio, 48000) as (path, _):
        try:
            return await run_in_threadpool(estimate_timeline, path)
        except Exception as exc:
            logger.exception("Music timeline failed")
            raise HTTPException(503, "Timeline model could not analyze this song. Check run-logs/python.log.") from exc


async def audio_from_raw_request(request: Request) -> UploadFile:
    """Accept Spring's streamed audio without multipart parsing."""
    extension = request.headers.get("x-audio-extension", "").lower()
    if extension not in {".mp3", ".wav"}:
        raise HTTPException(400, "Expected an MP3 or WAV upload.")
    spool = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
    try:
        total = 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > MAX_BYTES:
                raise HTTPException(413, "Maximum file size is 100 MB.")
            spool.write(chunk)
        spool.seek(0)
        return UploadFile(file=spool, filename="upload" + extension)
    except Exception:
        spool.close()
        raise


@app.post("/api/analyze-raw")
async def analyze_raw(request: Request):
    return await analyze(await audio_from_raw_request(request))


@app.post("/api/description-raw")
async def description_raw(request: Request):
    return await description(await audio_from_raw_request(request))


@app.post("/api/timeline-raw")
async def timeline_raw(request: Request):
    return await timeline(await audio_from_raw_request(request))
