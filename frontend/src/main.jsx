import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Activity, AudioLines, BarChart3, Brain, FileAudio, Info, Music2, Play, RotateCcw, Search, UploadCloud} from 'lucide-react';
import {filterSavedTracks} from './libraryFilters.js';
import WaveformPlayer from './WaveformPlayer.jsx';
import './style.css';

const labels = ["Energetic", "Euphoric", "Dreamy", "Aggressive", "Chaotic", "Melancholic", "Peaceful", "Tense", "Mysterious", "Playful"];
const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8080';

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.message || data.title || `Request failed (${response.status})`);
  return data;
}

function App() {
  const [file,setFile] = useState(null), [url,setUrl] = useState(''), [result,setResult] = useState(null), [mood,setMood] = useState(null), [moodError,setMoodError] = useState(''), [moodLoading,setMoodLoading] = useState(false), [error,setError] = useState(''), [loading,setLoading] = useState(false), [timeline,setTimeline] = useState(null), [timelineLoading,setTimelineLoading] = useState(false), [timelineError,setTimelineError] = useState('');
  const [tapTimes,setTapTimes] = useState([]);
  const [savedTracks,setSavedTracks] = useState([]), [libraryError,setLibraryError] = useState('');
  const [librarySearch,setLibrarySearch] = useState(''), [minBpm,setMinBpm] = useState(''), [maxBpm,setMaxBpm] = useState('');
  const [descriptionFilter,setDescriptionFilter] = useState(''), [favoritesOnly,setFavoritesOnly] = useState(false);
  const [activeId,setActiveId] = useState(null), [draftNotes,setDraftNotes] = useState('');
  const [manualBpm,setManualBpm] = useState(''), [favorite,setFavorite] = useState(false);
  const fileInput = useRef(null);
  const selectionRef = useRef(0);
  useEffect(()=> {if(!file){setUrl('');return;} const u=URL.createObjectURL(file);setUrl(u);return ()=>URL.revokeObjectURL(u)},[file]);
  async function loadLibrary() {
    try {
      const response = await fetch(`${API_BASE}/api/tracks`);
      setSavedTracks(await readResponse(response));
      setLibraryError('');
    } catch (e) {
      setLibraryError(String(e.message).includes('fetch') ? 'Cannot reach the Spring Boot service on port 8080.' : e.message);
    }
  }
  useEffect(() => { loadLibrary(); }, []);
  // A gap of more than two seconds starts a new tapping session.
  // Ignore accidental double-clicks instead of treating them as beats.
  function tapTempo(){
    const now=performance.now();
    setTapTimes(prev=>{
      if (!prev.length || now-prev[prev.length-1]>2000) return [now];
      if (now-prev[prev.length-1]<180) return prev;
      return [...prev,now].slice(-16);
    });
  }
  function median(values){
    if(!values.length)return null;
    const ordered=[...values].sort((a,b)=>a-b);
    const mid=Math.floor(ordered.length/2);
    return ordered.length%2?ordered[mid]:(ordered[mid-1]+ordered[mid])/2;
  }
  const tapIntervals=tapTimes.slice(1).map((t,i)=>t-tapTimes[i]);
  const medianInterval=median(tapIntervals);
  // Median interval is less sensitive to isolated early/late taps than the mean.
  const tapBpm=tapIntervals.length>=3?Math.round(60000/medianInterval*10)/10:null;
  const deviations=medianInterval===null?[]:tapIntervals.map(v=>Math.abs(v-medianInterval));
  const relativeVariation=medianInterval?median(deviations)/medianInterval:null;
  const tapStability=tapIntervals.length<4?'Collecting taps':relativeVariation<0.07?'Steady':relativeVariation<0.16?'Moderate':'Unsteady';
  const aiPulse=Number(result?.tempo_interpretations?.detected??result?.tempo);
  const compareCandidates=Number.isFinite(aiPulse)&&aiPulse>0&&tapBpm!==null?[
    {name:'main pulse',bpm:aiPulse},{name:'half-time',bpm:aiPulse/2},{name:'double-time',bpm:aiPulse*2}
  ]:[];
  const closestTapMatch=compareCandidates.length?compareCandidates.reduce((best,candidate)=>
    Math.abs(candidate.bpm-tapBpm)<Math.abs(best.bpm-tapBpm)?candidate:best
  ):null;
  const tapDifference=closestTapMatch?Math.round(Math.abs(closestTapMatch.bpm-tapBpm)*10)/10:null;
  function selectFile(f) {
    if(!f)return;
    if(!/\.(mp3|wav)$/i.test(f.name)){setError('Choose an MP3 or WAV file.');return;}
    if(f.size>100*1024*1024){setError('File must be 100 MB or smaller.');return;}
    selectionRef.current += 1;
    setTapTimes([]);setError('');setResult(null);setMood(null);setMoodError('');setMoodLoading(false);setTimeline(null);setTimelineError('');setActiveId(null);setDraftNotes('');setManualBpm('');setFavorite(false);setFile(f);
  }
  function clear(){setTapTimes([]);selectionRef.current+=1;setFile(null);setResult(null);setMood(null);setMoodError('');setMoodLoading(false);setTimeline(null);setTimelineError('');setError('');setLoading(false);setActiveId(null);setDraftNotes('');setManualBpm('');setFavorite(false);if(fileInput.current)fileInput.current.value='';}
  async function analyzeFeeling(audioFile, trackId, requestId, signal) {
    setMoodLoading(true);setMoodError('');setMood(null);
    try {
      const fd=new FormData();fd.append('audio',audioFile);
      const response=await fetch(`${API_BASE}/api/tracks/${trackId}/description`,{method:'POST',body:fd,signal});
      const data=await readResponse(response);
      if(selectionRef.current===requestId){setMood(data);loadLibrary();}
    }catch(e){
      if(e.name!=='AbortError'&&selectionRef.current===requestId)
        setMoodError(String(e.message).includes('fetch')?'Cannot reach the Spring Boot service on port 8080.':e.message);
    }finally{if(selectionRef.current===requestId)setMoodLoading(false);}
  }
  // Automatically fetch features and the full-song waveform after selecting a file.
  useEffect(()=>{
    if(!file)return;
    const requestId=selectionRef.current;
    const controller=new AbortController();
    async function run(){
      setLoading(true);setError('');
      try{
        const fd=new FormData();fd.append('audio',file);
        const response=await fetch(`${API_BASE}/api/tracks/analyze`,{method:'POST',body:fd,signal:controller.signal});
        const data=await readResponse(response);
        if(selectionRef.current===requestId){
          setResult(data);setActiveId(data.id);loadLibrary();
          // Analyze the uploaded file's feeling without another button click.
          void analyzeFeeling(file,data.id,requestId,controller.signal);
        }
      }catch(e){
        if(e.name!=='AbortError'&&selectionRef.current===requestId)
          setError(String(e.message).includes('fetch')?'Cannot reach the Spring Boot service on port 8080.':e.message);
      }finally{if(selectionRef.current===requestId)setLoading(false);}
    }
    run();
    return ()=>controller.abort();
  },[file]);
  async function analyze(){
    if(!file){setError('Upload a song first.');return;}
    // Re-select the current file to re-run the waveform and feature analysis.
    selectionRef.current+=1;setResult(null);setMood(null);setMoodError('');setMoodLoading(false);setActiveId(null);setFile(null);
    setTimeout(()=>setFile(file),0);
  }
  async function analyzeTimeline(){
    if(!file||!activeId)return;
    const requestId=selectionRef.current;
    setTimelineLoading(true);setTimelineError('');setTimeline(null);
    try{
      const fd=new FormData();fd.append('audio',file);
      const response=await fetch(`${API_BASE}/api/tracks/${activeId}/timeline`,{method:'POST',body:fd});
      const data=await readResponse(response);
      if(selectionRef.current===requestId)setTimeline(data);
    }catch(e){if(selectionRef.current===requestId)setTimelineError(String(e.message).includes('fetch')?'Cannot reach the Spring Boot service on port 8080.':e.message);}
    finally{setTimelineLoading(false)}
  }
  function detectMood(){
    if(!file||!activeId){setMoodError('Upload and analyze a song first.');return;}
    void analyzeFeeling(file,activeId,selectionRef.current);
  }
  async function saveReview(changes) {
    if(!activeId)return;
    setLibraryError('');
    try {
      const response=await fetch(`${API_BASE}/api/tracks/${activeId}`,{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)
      });
      const updated=await readResponse(response);
      if(Object.hasOwn(changes,'notes'))setDraftNotes(updated.notes||'');
      if(Object.hasOwn(changes,'correctedBpm'))setManualBpm(updated.correctedBpm==null?'':String(updated.correctedBpm));
      if(Object.hasOwn(changes,'favorite'))setFavorite(updated.favorite);
      await loadLibrary();
    }catch(e){setLibraryError(e.message)}
  }
  function saveNotesAndTempo(){
    const bpm=manualBpm.trim()?Number(manualBpm):null;
    if(bpm!==null&&(!Number.isFinite(bpm)||bpm<30||bpm>300)){
      setLibraryError('Corrected tempo must be between 30 and 300 BPM.');return;
    }
    saveReview({notes:draftNotes.trim(),correctedBpm:bpm});
  }
  async function removeSavedTrack(id) {
    try {
      const response=await fetch(`${API_BASE}/api/tracks/${id}`,{method:'DELETE'});
      if(!response.ok)await readResponse(response);
      if(activeId===id)setActiveId(null);
      await loadLibrary();
    }catch(e){setLibraryError(e.message)}
  }
  const filtersActive = Boolean(librarySearch || minBpm || maxBpm || descriptionFilter || favoritesOnly);
  const invalidBpmRange = minBpm !== '' && maxBpm !== '' && Number(minBpm) > Number(maxBpm);
  const visibleTracks = invalidBpmRange ? [] : filterSavedTracks(savedTracks, {
    search: librarySearch, minBpm, maxBpm, description: descriptionFilter, favoritesOnly,
  });
  function clearLibraryFilters() {
    setLibrarySearch('');setMinBpm('');setMaxBpm('');setDescriptionFilter('');setFavoritesOnly(false);
  }
  const metrics = [
    {icon:'♫',name:'Detected musical pulse (BPM)',value:result?.tempo??'--',color:'blue'},
    {icon:'〰',name:'Energy (RMS)',value:result?.energy??'--',color:'pink'},
    {icon:'☼',name:'Brightness (Hz)',value:result?.brightness??'--',color:'yellow'},
    {icon:'▮',name:'Zero-crossing rate',value:result?.zcr??'--',color:'cyan'},
    {icon:'◷',name:'Duration (seconds)',value:result?.duration??'--',color:'purple'},
    {icon:'♬',name:'Analyzed length',value:result?.analyzed_length?`${result.analyzed_length}s`:'--',color:'green'},
  ];
  return <div className="app">
    <header><div className="brand"><Music2 size={42}/><div><h1>Music Description AI</h1><p>Upload a song, play it, and discover its musical character.</p></div></div><span className="about"><Info size={15}/> Music analysis lab</span></header>
    <div className="pills"><span><FileAudio/> MP3 / WAV Support</span><span><BarChart3/> Audio Feature Analysis</span><span><Brain/> Experimental Music Descriptions</span></div>
    <main className="columns">
      <section className="left">
        <div className="panel upload-panel"><h2><UploadCloud/> 1. Upload a Song</h2>
          <div className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();selectFile(e.dataTransfer.files[0])}}>
            <UploadCloud size={42}/><p>{file?file.name:'Drag and drop an MP3 or WAV file here'}</p><span>– or –</span>
            <button className="primary browse" onClick={()=>fileInput.current?.click()}>Browse Files</button>
            <input ref={fileInput} type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" hidden onChange={e=>selectFile(e.target.files?.[0])}/>
            <small>Maximum file size: 100 MB · Maximum length: 10 minutes</small>
          </div>
        </div>
        <div className="panel"><h2><Play/> 2. Uploaded Song Player</h2><div className="player">{url?<WaveformPlayer src={url} waveform={result?.waveform}/>:<p>Upload a song to see its waveform and play it here.</p>}</div><div className="actions"><button className="primary" disabled={loading||!file} onClick={analyze}><AudioLines size={17}/>{loading?'Analyzing…':'Analyze Again'}</button><button className="secondary" onClick={clear}><RotateCcw size={17}/> Clear</button></div><small className="muted">Analyze Again creates a new saved result from the uploaded file.</small>{error&&<p className="error" role="alert">{error}</p>}</div>
      </section>
      <section className="right">
        <div className="panel"><h2><Brain/> Music Feeling Match <span className="coming">Experimental</span></h2>
          <div className="emotion-body"><div className="circle">{mood?.description?({'Energetic':'⚡','Euphoric':'🌈','Dreamy':'🌌','Aggressive':'🔥','Chaotic':'🌀','Melancholic':'🌧️','Peaceful':'🕊️','Tense':'😬','Mysterious':'🔮','Playful':'🎉'}[mood.description]):'?'}</div><div className="emotion-list">
            <div className="notice" aria-live="polite">{mood?.description?`Top feeling: ${mood.description}. Analyzed ${mood.analysis_length_seconds}s from ${mood.analysis_start_seconds}s.`:moodLoading?'Listening to the uploaded file… The first run downloads the CLAP model and can take a while.':loading?'Preparing the uploaded audio and waveform…':'Upload an MP3 or WAV to estimate its musical feeling automatically.'}</div>
            {labels.map(l=><div className="meter" key={l}><span>{l}</span><div className="track"><div className="meter-fill" style={{width:`${Math.max(0,Math.min(100,(mood?.scores?.[l]??0)*100))}%`}} /></div><span>{mood?`${Math.round((mood.scores?.[l]??0)*100)}%`:'—'}</span></div>)}
          </div></div>
          <button className="primary mood-button" disabled={!activeId||moodLoading} onClick={detectMood}><Brain size={17}/>{moodLoading?'Analyzing feelings…':mood?'Analyze Feelings Again':'Try Feelings Analysis'}</button>
          {moodError&&<p className="error" role="alert">{moodError}</p>}
          <p className="mood-warning">These relative scores come from an excerpt of your uploaded file. They are experimental matches, not calibrated probabilities or a reading of a listener’s feelings.</p>
        </div>
        <div className="panel"><h2><BarChart3/> Audio Features</h2><div className="metrics">{metrics.map(m=><div className={'metric '+m.color} key={m.name}><span className="metric-icon">{m.icon}</span><div><small>{m.name}</small><strong>{m.value}</strong></div></div>)}</div>
          <div className="tempo-box">
            <h3>🥁 Tempo interpretations</h3>
            <div className="tempo-choices">
              <div><span>Half-time</span><strong>{result?.tempo_interpretations?.half_time ?? '—'} BPM</strong></div>
              <div><span>Detected pulse</span><strong>{result?.tempo_interpretations?.detected ?? '—'} BPM</strong></div>
              <div><span>Double-time</span><strong>{result?.tempo_interpretations?.double_time ?? '—'} BPM</strong></div>
            </div>
            <p><b>Primary displayed pulse:</b> {result?.tempo_interpretations?.detected ?? '—'} BPM <span className="muted">(automatic beat tracker)</span></p>
            <p><b>Strongest onset-periodicity interpretation:</b> {result?.tempo_interpretations?.suggested ?? '—'} BPM <span className="muted">(may indicate half-time feel)</span></p>
            <div className="tap-tempo" aria-label="Manual tap tempo"><div><h3>👆 Tap Tempo</h3><small>Play the song and tap each main beat. Four or more taps produce a median-based BPM. A pause over 2 seconds restarts the count.</small></div><div className="tap-actions"><button type="button" className="primary" onClick={tapTempo}>Tap beat</button><button type="button" className="secondary" onClick={()=>setTapTimes([])}>Reset</button></div><p><b>Your tapped tempo:</b> {tapBpm === null ? '—' : `${tapBpm} BPM`} <span className="muted">({tapTimes.length} taps)</span></p><p><b>Tap consistency:</b> {tapStability}{relativeVariation!==null&&tapIntervals.length>=4?` · ${Math.round(relativeVariation*100)}% median timing deviation`:''}</p>{closestTapMatch&&<p><b>Closest AI interpretation:</b> {closestTapMatch.name} ({closestTapMatch.bpm.toFixed(1)} BPM) · {tapDifference.toFixed(1)} BPM apart</p>}<small>Tap consistency measures timing regularity, not whether your taps follow the correct musical beat. The comparison is informational, not a validation of the AI estimate.</small></div>
            <small>{result?.tempo_interpretations?.suggestion_reason || 'The tempo estimate compares rhythmic repetition across multiple sections. Half-time/double-time may remain ambiguous.'} Reliability: {result?.tempo_interpretations?.confidence ?? '—'}. Scores are not probabilities.</small>
          </div>
        </div>
      </section>
    </main>
    <section className="panel timeline-panel">
      <div className="timeline-head"><div><h2><Activity/> Music Description Timeline</h2><p>See how your track's character changes across eight sampled excerpts.</p></div><button className="primary" disabled={!activeId||timelineLoading} onClick={analyzeTimeline}>{timelineLoading?'Describing sections… (CPU analysis can be slow)':'Analyze Full-Song Timeline'}</button></div>
      {timelineError&&<p className="error" role="alert">{timelineError}</p>}
      {timeline?.points?.length?<><div className="timeline-grid">{timeline.points.map((point,i)=><div className="timeline-segment" key={i} title={`Starts at ${point.start}s · ${point.description}`}><span className="timeline-top">{Math.round(point.time)}s</span><span className="timeline-mood">{point.description}</span><span className="timeline-score">{Math.round((point.scores?.[point.description]??0)*100)}% relative match</span></div>)}</div><p className="mood-warning">{timeline.disclaimer} Each sample covers up to {timeline.window_seconds}s. The analysis is spread across the full {timeline.duration}s song.</p></>:<div className="timeline-empty">{timelineLoading?'Analyzing sampled sections across the track…':'Upload a song, then choose Analyze Full-Song Timeline.'}</div>}
    </section>
    <section className="panel library-panel">
      <div className="timeline-head"><div><h2><Music2/> Saved Listening Library</h2><p>Keep analysis results, your own tempo correction, and listening notes between sessions.</p></div><button className="secondary" onClick={loadLibrary}>Refresh Library</button></div>
      <div className="library-filters" role="search" aria-label="Filter saved tracks">
        <label className="library-search"><span><Search size={15}/> Search tracks</span><input type="search" value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)} placeholder="Filename, description, or notes"/></label>
        <label>Min BPM<input type="number" min="30" max="300" step="0.1" inputMode="decimal" value={minBpm} onChange={e=>setMinBpm(e.target.value)} placeholder="e.g. 80"/></label>
        <label>Max BPM<input type="number" min="30" max="300" step="0.1" inputMode="decimal" value={maxBpm} onChange={e=>setMaxBpm(e.target.value)} placeholder="e.g. 110"/></label>
        <label className="description-filter">Top description<select value={descriptionFilter} onChange={e=>setDescriptionFilter(e.target.value)}><option value="">All descriptions</option>{labels.map(label=><option key={label} value={label}>{label}</option>)}</select></label>
        <label className="favorites-filter"><input type="checkbox" checked={favoritesOnly} onChange={e=>setFavoritesOnly(e.target.checked)}/> Favorites only</label>
      </div>
      <div className="library-filter-status"><span role="status">{visibleTracks.length} of {savedTracks.length} saved results</span><button type="button" className="clear-filters" disabled={!filtersActive} onClick={clearLibraryFilters}>Clear filters</button></div>
      {activeId&&<div className="review-card">
        <div><strong>Review this track</strong><p>Automatic BPM: {result?.tempo??'—'} · Manual correction: {manualBpm||'—'}</p></div>
        <label>Your BPM correction <input type="number" min="30" max="300" step="0.1" value={manualBpm} onChange={e=>setManualBpm(e.target.value)} placeholder="Optional BPM"/></label>
        <button className="secondary" disabled={tapBpm===null} onClick={()=>setManualBpm(String(tapBpm))}>Use tapped BPM</button>
        <label className="notes-label">Listening notes <textarea maxLength="500" value={draftNotes} onChange={e=>setDraftNotes(e.target.value)} placeholder="What did you hear in this track?"/></label>
        <div className="review-actions"><button className="primary" onClick={saveNotesAndTempo}>Save Notes & BPM</button><button className="secondary" onClick={()=>saveReview({favorite:!favorite})}>{favorite?'★ Favorited':'☆ Add Favorite'}</button></div>
      </div>}
      {libraryError&&<p className="error" role="alert">{libraryError}</p>}
      <div className="saved-grid">{visibleTracks.map(track=><article className="saved-track" key={track.id}>
        <div className="saved-title"><strong>{track.favorite?'★ ':''}{track.filename}</strong><small>{new Date(track.analyzedAt).toLocaleDateString()}</small></div>
        <p>{track.correctedBpm??track.tempo??'—'} BPM {track.correctedBpm!=null?'(your correction)':''} · {track.duration??'—'}s {track.description?`· ${track.description}`:''}</p>
        {track.notes&&<p className="saved-note">{track.notes}</p>}
        <button className="delete-track" onClick={()=>removeSavedTrack(track.id)}>Delete saved result</button>
      </article>)}</div>
      {savedTracks.length>0&&filtersActive&&!libraryError&&<p className="library-filter-hint">{invalidBpmRange?'Minimum BPM must be less than or equal to maximum BPM.':visibleTracks.length===0?'No matches. Try a different description or BPM range.':'BPM uses your correction when one is saved. Description filters use the top saved match.'}</p>}
      {!savedTracks.length&&!libraryError&&<p className="timeline-empty">Upload a song to save your first analysis. Audio files themselves are not stored.</p>}
    </section>
    <footer>Experimental music description matching and audio features for uploaded files.</footer>
  </div>
}

createRoot(document.getElementById('root')).render(<App/>);
