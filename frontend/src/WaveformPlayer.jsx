import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pause, Play, Volume2} from 'lucide-react';

function clock(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export default function WaveformPlayer({src, waveform}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [error, setError] = useState('');

  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setDuration(0);
    setError('');
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [src, volume]);

  const bars = useMemo(() => {
    if (!Array.isArray(waveform) || waveform.length < 2) return [];
    const count = Math.min(160, waveform.length);
    const peaks = Array.from({length: count}, (_, i) => {
      const start = Math.floor(i * waveform.length / count);
      const end = Math.max(start + 1, Math.floor((i + 1) * waveform.length / count));
      return Math.max(0, ...waveform.slice(start, end).map(v => Number(v) || 0));
    });
    const maxPeak = Math.max(...peaks, 0.001);
    return peaks.map(peak => Math.max(3, peak / maxPeak * 86));
  }, [waveform]);

  const progress = duration > 0 ? Math.max(0, Math.min(1, position / duration)) : 0;

  function seek(seconds) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const next = Math.max(0, Math.min(audio.duration, seconds));
    audio.currentTime = next;
    setPosition(next);
  }

  function seekFromPointer(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !duration) return;
    seek((event.clientX - rect.left) / rect.width * duration);
  }

  function onKeyDown(event) {
    const offsets = {ArrowLeft: -5, ArrowRight: 5, PageDown: -15, PageUp: 15};
    if (event.key in offsets) {
      event.preventDefault();
      seek(position + offsets[event.key]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      seek(event.key === 'Home' ? 0 : duration);
    }
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
      setError('');
    } catch {
      setError('This browser could not play the uploaded audio. Try a different MP3 or WAV.');
    }
  }

  return <div className="uploaded-player">
    <audio ref={audioRef} src={src} preload="metadata"
      onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onDurationChange={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onEnded={() => setPlaying(false)}
      onError={() => setError('This browser could not play the uploaded audio. Try a different MP3 or WAV.')}/>
    <div className="uploaded-player-controls">
      <button className="wave-play" type="button" onClick={toggle} aria-label={playing ? 'Pause uploaded song' : 'Play uploaded song'}>
        {playing ? <Pause size={21} fill="currentColor"/> : <Play size={21} fill="currentColor"/>}
      </button>
      <span className="wave-time" aria-live="off">{clock(position)}</span>
      <div className="waveform-seek" role="slider" tabIndex={bars.length && duration ? 0 : -1}
        aria-label="Seek in uploaded song" aria-valuemin={0} aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)} aria-valuetext={`${clock(position)} of ${clock(duration)}`}
        onPointerDown={event => {if (bars.length && duration) {event.currentTarget.setPointerCapture(event.pointerId); seekFromPointer(event);}}}
        onPointerMove={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);}}
        onPointerUp={event => {if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);}}
        onKeyDown={onKeyDown}>
        {bars.length ? <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="1000" y1="50" y2="50" stroke="#344a78" strokeWidth="1"/>
          {bars.map((height, i) => <rect key={i} x={i * 1000 / bars.length + 1}
            y={(100 - height) / 2} width={Math.max(1, 1000 / bars.length - 2)} height={height}
            rx="2" fill={i / bars.length <= progress ? '#bd64ff' : '#6075ad'}/>)}
          <line x1={progress * 1000} x2={progress * 1000} y1="2" y2="98" stroke="#f6d9ff" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
        </svg> : <span className="waveform-loading">Preparing the full-song waveform…</span>}
      </div>
      <span className="wave-time">{clock(duration)}</span>
      <label className="wave-volume"><Volume2 size={18}/><span className="sr-only">Volume for uploaded song</span>
        <input type="range" min="0" max="1" step="0.05" value={volume} onChange={event => setVolume(Number(event.target.value))}/>
      </label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {bars.length > 0 && <small className="waveform-caption">Full-song waveform · click or drag to seek · arrow keys move five seconds</small>}
  </div>;
}
