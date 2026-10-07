import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  exportFileName,
  hookConfig,
  listAudioRel,
  runPostDownloadHook,
} from '../lib/postDownloadHook.mjs'

async function tmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-hook-'))
}

test('hookConfig is disabled unless POST_EXPORT_ENABLED=true', () => {
  assert.equal(hookConfig({}).enabled, false)
  assert.equal(hookConfig({ POST_EXPORT_ENABLED: 'false' }).enabled, false)
  assert.equal(hookConfig({ POST_EXPORT_ENABLED: 'TRUE' }).enabled, true)
})

test('exportFileName flattens the library path and falls back to the basename', () => {
  assert.equal(
    exportFileName('/music/Artist/Album (2020)/01 Song.m4a', '/music'),
    'Artist - Album (2020) - 01 Song.m4a',
  )
  assert.equal(exportFileName('/elsewhere/x.m4a', '/music'), 'x.m4a')
  const long = `/music/${'a'.repeat(120)}/${'b'.repeat(120)}/01 Song.m4a`
  const name = exportFileName(long, '/music')
  assert.ok(Buffer.byteLength(name) <= 255)
  assert.ok(name.endsWith('01 Song.m4a'))
})

test('listAudioRel returns relative audio paths only', async () => {
  const dir = await tmp()
  await fsp.mkdir(path.join(dir, 'A', 'B'), { recursive: true })
  await fsp.writeFile(path.join(dir, 'A', 'B', '01.m4a'), 'x')
  await fsp.writeFile(path.join(dir, 'A', 'B', 'folder.jpg'), 'x')
  await fsp.writeFile(path.join(dir, 'A', 'B', '01.lrc'), 'x')
  assert.deepEqual(await listAudioRel(dir), [path.join('A', 'B', '01.m4a')])
})

test('hook does nothing when disabled', async () => {
  let called = 0
  const res = await runPostDownloadHook({ id: 'j' }, ['/x/a.m4a'], {
    config: { enabled: false },
    run: async () => { called += 1 },
  })
  assert.deepEqual(res, { exported: 0, failed: 0 })
  assert.equal(called, 0)
})

test('hook copies, processes the copy and leaves the original untouched', async () => {
  const music = await tmp()
  const exp = await tmp()
  const src = path.join(music, 'Artist', 'Album', '01 Song.m4a')
  await fsp.mkdir(path.dirname(src), { recursive: true })
  await fsp.writeFile(src, 'original')
  await fsp.writeFile(path.join(music, 'Artist', 'Album', '02 Song.flac'), 'flac')

  const seen = []
  const res = await runPostDownloadHook(
    { id: 'j' },
    [src, src, path.join(music, 'Artist', 'Album', '02 Song.flac')],
    {
      config: { enabled: true, exportDir: exp, script: 's.sh', musicRoot: music, timeoutMs: 1000 },
      run: async (_script, file) => {
        seen.push(file)
        assert.notEqual(file, src)
        await fsp.writeFile(file, 'cleaned')
      },
    },
  )
  assert.deepEqual(res, { exported: 1, failed: 0 })
  assert.equal(seen.length, 1)
  assert.equal(await fsp.readFile(src, 'utf8'), 'original')
  const out = path.join(exp, 'Artist - Album - 01 Song.m4a')
  assert.equal(await fsp.readFile(out, 'utf8'), 'cleaned')
  assert.deepEqual(await fsp.readdir(path.join(exp, '.tmp')), [])
})

test('a failing script is logged, cleaned up and does not throw', async () => {
  const music = await tmp()
  const exp = await tmp()
  const src = path.join(music, 'A', 'B', 'c.m4a')
  await fsp.mkdir(path.dirname(src), { recursive: true })
  await fsp.writeFile(src, 'x')
  const origError = console.error
  console.error = () => {}
  try {
    const res = await runPostDownloadHook({ id: 'j' }, [src], {
      config: { enabled: true, exportDir: exp, script: 's.sh', musicRoot: music, timeoutMs: 1000 },
      run: async () => { throw new Error('boom') },
    })
    assert.deepEqual(res, { exported: 0, failed: 1 })
  } finally {
    console.error = origError
  }
  assert.deepEqual(await fsp.readdir(exp), ['.tmp'])
  assert.deepEqual(await fsp.readdir(path.join(exp, '.tmp')), [])
})
