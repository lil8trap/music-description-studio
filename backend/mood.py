"""Experimental zero-shot music description ranking with CLAP (no calibrated confidence)."""
from functools import lru_cache
import numpy as np
import librosa

MODEL_NAME = "laion/clap-htsat-unfused"
DESCRIPTIONS = {
    "Energetic": "high-energy, driving music with strong rhythmic momentum",
    "Euphoric": "euphoric, uplifting and triumphant music with a soaring atmosphere",
    "Dreamy": "dreamy, floating and atmospheric music with soft textures",
    "Aggressive": "aggressive, abrasive and forceful music with hard-hitting sounds",
    "Chaotic": "chaotic, unpredictable and frantic music with restless arrangements",
    "Melancholic": "melancholic, wistful and introspective music with a bittersweet tone",
    "Peaceful": "peaceful, gentle and tranquil music with a soothing atmosphere",
    "Tense": "tense, suspenseful and uneasy music with an anxious atmosphere",
    "Mysterious": "mysterious, eerie and enigmatic music with an uncanny mood",
    "Playful": "playful, whimsical and bouncy music with quirky melodies",
}

@lru_cache(maxsize=1)
def get_classifier():
    from transformers import pipeline
    return pipeline(task="zero-shot-audio-classification", model=MODEL_NAME, device=-1)

def estimate_mood(audio_path: str):
    # CLAP expects 48 kHz. Limit to a 10s clip to keep CPU demand reasonable.
    duration = float(librosa.get_duration(path=audio_path))
    start = max(0.0, min(duration / 2 - 5.0, 45.0))
    samples, _ = librosa.load(audio_path, sr=48000, mono=True, offset=start, duration=10.0)
    if len(samples) == 0:
        raise ValueError("Audio excerpt is empty")
    prompts = list(DESCRIPTIONS.values())
    ranked = get_classifier()(
        np.asarray(samples, dtype=np.float32),
        candidate_labels=prompts,
        hypothesis_template="This audio sounds like {}."
    )
    scores = {name: 0.0 for name in DESCRIPTIONS}
    reverse = {desc: name for name, desc in DESCRIPTIONS.items()}
    for result in ranked:
        label = reverse.get(result["label"])
        if label is not None:
            scores[label] = round(float(result["score"]), 4)
    top = max(scores, key=scores.get)
    return {
        "description": top,
        "scores": scores,
        "model": MODEL_NAME,
        "analysis_start_seconds": round(start, 1),
        "analysis_length_seconds": round(len(samples) / 48000, 1),
        "disclaimer": "Experimental relative audio-text similarity scores, not calibrated probabilities or objective descriptions of a song."
    }


def estimate_timeline(audio_path: str, windows: int = 8, clip_seconds: float = 8.0):
    """Rank descriptions at evenly spaced points in a song (sampled timeline)."""
    duration = float(librosa.get_duration(path=audio_path))
    if duration <= 0:
        raise ValueError("Empty audio")
    clip_seconds = min(clip_seconds, duration)
    max_start = max(0.0, duration - clip_seconds)
    starts = np.linspace(0, max_start, min(windows, max(1, int(np.ceil(duration / clip_seconds)))))
    classifier = get_classifier()
    prompts = list(DESCRIPTIONS.values())
    reverse = {desc: name for name, desc in DESCRIPTIONS.items()}
    points = []
    for start in starts:
        samples, _ = librosa.load(audio_path, sr=48000, mono=True, offset=float(start), duration=clip_seconds)
        if len(samples) == 0:
            continue
        ranked = classifier(
            np.asarray(samples, dtype=np.float32),
            candidate_labels=prompts,
            hypothesis_template="This audio sounds like {}."
        )
        scores = {name: 0.0 for name in DESCRIPTIONS}
        for entry in ranked:
            label = reverse.get(entry['label'])
            if label:
                scores[label] = round(float(entry['score']), 4)
        points.append({
            'time': round(float(start) + len(samples) / 96000, 1),
            'start': round(float(start), 1),
            'description': max(scores, key=scores.get),
            'scores': scores,
        })
    return {
        'points': points,
        'duration': round(duration, 1),
        'window_seconds': clip_seconds,
        'model': MODEL_NAME,
        'disclaimer': 'Sampled excerpts, not continuous analysis. Scores are relative audio-text matches, not probabilities.'
    }
