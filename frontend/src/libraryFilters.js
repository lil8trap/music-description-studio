// The local library is small, so filter its fetched summaries immediately in the browser.
// Corrected BPM takes priority over the model's original estimate.
export function filterSavedTracks(tracks, {
  search = '', minBpm = '', maxBpm = '', description = '', favoritesOnly = false,
} = {}) {
  const query = search.trim().toLocaleLowerCase();
  const min = minBpm === '' ? null : Number(minBpm);
  const max = maxBpm === '' ? null : Number(maxBpm);

  return tracks.filter(track => {
    const text = [track.filename, track.description, track.notes]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    if (query && !text.includes(query)) return false;
    if (description && track.description !== description) return false;
    if (favoritesOnly && !track.favorite) return false;

    const savedBpm = track.correctedBpm ?? track.tempo;
    const bpm = savedBpm == null ? null : Number(savedBpm);
    if (min !== null && (bpm === null || !Number.isFinite(bpm) || bpm < min)) return false;
    if (max !== null && (bpm === null || !Number.isFinite(bpm) || bpm > max)) return false;
    return true;
  });
}
