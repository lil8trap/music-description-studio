import test from 'node:test';
import assert from 'node:assert/strict';
import {filterSavedTracks} from './libraryFilters.js';

const tracks = [
  {filename: 'Late Night.mp3', description: 'Dreamy', notes: 'ambient intro', tempo: 140, correctedBpm: 70, favorite: true},
  {filename: 'Drums.wav', description: 'Energetic', notes: 'dance set', tempo: 95, correctedBpm: null, favorite: false},
  {filename: 'Unknown.mp3', description: null, notes: '', tempo: null, correctedBpm: null, favorite: false},
];

test('searches filenames, notes, and descriptions without case sensitivity', () => {
  for (const word of ['NIGHT', 'ambient', 'dreamy']) {
    assert.deepEqual(filterSavedTracks(tracks, {search: word}), [tracks[0]]);
  }
});

test('combines the description, favorite, and inclusive BPM filters', () => {
  assert.deepEqual(filterSavedTracks(tracks, {
    description: 'Dreamy', favoritesOnly: true, minBpm: '70', maxBpm: '70',
  }), [tracks[0]]);
  assert.deepEqual(filterSavedTracks(tracks, {minBpm: '90', maxBpm: '100'}), [tracks[1]]);
});

test('uses corrected BPM and omits tracks without BPM when a range is set', () => {
  assert.deepEqual(filterSavedTracks(tracks, {minBpm: '120'}), []);
  assert.deepEqual(filterSavedTracks(tracks), tracks);
});
