import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAlbum, normalizePlaylist } from '../lib/appleApi.mjs'

const song = (id, n) => ({ id, type: 'songs', attributes: { name: `Song ${n}`, trackNumber: n } })
const video = (id, n) => ({ id, type: 'music-videos', attributes: { name: `Song ${n}`, trackNumber: n } })

test('an album with music videos lists and counts only its songs', () => {
  // Hi This Is Flume: 17 songs plus a video for each, trackCount 34
  const songs = Array.from({ length: 17 }, (_, i) => song(`s${i + 1}`, i + 1))
  const videos = Array.from({ length: 17 }, (_, i) => video(`v${i + 1}`, i + 1))
  const album = normalizeAlbum({
    id: '1716793948',
    attributes: { name: 'Hi This Is Flume (Mixtape)', trackCount: 34 },
    relationships: { tracks: { data: [...songs, ...videos] } },
  })
  assert.equal(album.tracks.length, 17)
  assert.equal(album.trackCount, 17)
  assert.deepEqual(album.tracks.map((t) => t.id), songs.map((t) => t.id))
})

test('trackCount stays right when Apple returns only part of the track list', () => {
  const album = normalizeAlbum({
    id: '2',
    attributes: { name: 'Long', trackCount: 400 },
    relationships: { tracks: { data: [song('s1', 1), video('v1', 1)] } },
  })
  assert.equal(album.trackCount, 399)
})

test('albums without videos keep Apple\'s trackCount', () => {
  const album = normalizeAlbum({
    id: '3',
    attributes: { name: 'Plain', trackCount: 2 },
    relationships: { tracks: { data: [song('s1', 1), song('s2', 2)] } },
  })
  assert.equal(album.trackCount, 2)
  assert.equal(album.tracks.length, 2)
})

test('playlists drop music videos too', () => {
  const playlist = normalizePlaylist({
    id: 'pl.1',
    attributes: { name: 'Mix', trackCount: 3 },
    relationships: { tracks: { data: [song('s1', 1), video('v1', 2), song('s2', 3)] } },
  })
  assert.deepEqual(playlist.tracks.map((t) => t.id), ['s1', 's2'])
  assert.equal(playlist.trackCount, 2)
})
