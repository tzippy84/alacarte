import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

const tmpConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-namelimit-'))
process.env.AMDL_CONFIG_DIR = tmpConfig
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0

const {
  amdpNameCharLimit,
  fitFileName,
  restoreTruncatedName,
  sanitizeSegment,
  setNameByteLimit,
} = await import('../lib/libraryMatchKey.mjs')
const { detectNameByteLimit, mergeMove, probeNameByteLimit } = await import('../lib/folderLayout.mjs')
const { writeAmdpConfig } = await import('../lib/amdpRunner.mjs')
const { __test__ } = await import('../lib/queue.mjs')
const { restoreTrackFileName, restoreTrackFileNames, nameTooLongMessage } = __test__

// What amdp writes: the title cut to limit-max characters, path characters
// replaced, then trimmed.
function amdpCut(name) {
  return Array.from(name).slice(0, amdpNameCharLimit()).join('').replace(/[/\\<>:"|?*]/g, '_').trim()
}

function makeFlac(dir, name, title) {
  const abs = path.join(dir, name)
  const res = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.05', '-c:a', 'flac', '-metadata', `TITLE=${title}`, abs],
    { encoding: 'utf8' },
  )
  if (res.status !== 0) throw new Error('ffmpeg could not create test flac')
  return abs
}

test('fitFileName leaves names under the limit alone', () => {
  setNameByteLimit(255)
  assert.equal(fitFileName('01. Get Lucky.flac'), '01. Get Lucky.flac')
  assert.equal(fitFileName('cover.jpg'), 'cover.jpg')
})

test('fitFileName cuts by bytes on a character boundary and keeps the extension', () => {
  for (const limit of [255, 143]) {
    setNameByteLimit(limit)
    const name = `01. ${'泡'.repeat(120)}.flac`
    const fitted = fitFileName(name)
    assert.ok(Buffer.byteLength(fitted) <= limit, `${limit}: ${Buffer.byteLength(fitted)} bytes`)
    assert.ok(fitted.endsWith('.flac'))
    assert.ok(!fitted.includes('�'))
  }
  setNameByteLimit(255)
})

test('a track and its sidecars get the same stem', () => {
  setNameByteLimit(143)
  const stem = `01. ${'é'.repeat(70)}`
  const stems = ['.m4a', '.flac', '.lrc', '.ttml'].map((ext) =>
    path.basename(fitFileName(stem + ext), path.extname(fitFileName(stem + ext))),
  )
  assert.equal(new Set(stems).size, 1)
  setNameByteLimit(255)
})

test('folder names follow the limit and leave room for a version suffix', () => {
  setNameByteLimit(143)
  const folder = sanitizeSegment('泡'.repeat(100))
  assert.ok(Buffer.byteLength(`${folder} (Atmos)`) <= 143)
  setNameByteLimit(255)
  assert.equal(sanitizeSegment('泡'.repeat(200)), '泡'.repeat(76))
})

test('amdp is told a character limit that always fits the byte limit', async () => {
  for (const limit of [255, 143]) {
    setNameByteLimit(limit)
    const worst = `100. ${'😀'.repeat(amdpNameCharLimit())}.ttml`
    assert.ok(Buffer.byteLength(worst) <= limit, `${limit}: ${Buffer.byteLength(worst)} bytes`)
    const cfgPath = await writeAmdpConfig({ settings: {}, mediaUserToken: 't', stagingRoot: tmpConfig })
    assert.match(await fsp.readFile(cfgPath, 'utf8'), new RegExp(`^limit-max: ${amdpNameCharLimit()}$`, 'm'))
  }
  setNameByteLimit(255)
})

test('restoreTruncatedName only restores names amdp actually cut', () => {
  setNameByteLimit(255)
  const long = 'Symphony No. 9 in D Minor, Op. 125 "Choral": IV. Presto – Allegro assai – Andante maestoso'
  assert.equal(restoreTruncatedName(amdpCut(long), long), long.replace(/[":]/g, '_'))
  assert.equal(restoreTruncatedName('Get Lucky', 'Get Lucky'), 'Get Lucky')
  assert.equal(restoreTruncatedName(amdpCut(long), 'Something else entirely'), amdpCut(long))
  assert.equal(restoreTruncatedName('Short', null), 'Short')
})

test('restoreTrackFileName puts the full title back behind the track number', () => {
  setNameByteLimit(255)
  // over amdp's character cut, under the byte limit
  const title = 'あ'.repeat(75)
  assert.equal(restoreTrackFileName(`03. ${amdpCut(title)}.m4a`, title), `03. ${title}.m4a`)
  assert.equal(restoreTrackFileName('03. Get Lucky.m4a', 'Get Lucky'), '03. Get Lucky.m4a')
})

test('long titles import with their full name, cut only to the byte limit', async (t) => {
  if (!hasFfmpeg) {
    t.skip('ffmpeg not available on this host')
    return
  }
  for (const limit of [255, 143]) {
    setNameByteLimit(limit)
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-namelimit-stage-'))
    const library = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-namelimit-lib-'))
    const title = 'A Very Long Track Title That Goes On And On Past The Limit, Part One (Extended Mix)'
    const staged = `01. ${amdpCut(title)}`
    makeFlac(staging, `${staged}.flac`, title)
    await fsp.writeFile(path.join(staging, `${staged}.lrc`), '[00:00.00]x')

    await restoreTrackFileNames(staging)
    await mergeMove(staging, library)

    const files = (await fsp.readdir(library)).sort()
    assert.equal(files.length, 2)
    for (const f of files) assert.ok(Buffer.byteLength(f) <= limit, `${limit}: ${f}`)
    const [flac, lrc] = [files.find((f) => f.endsWith('.flac')), files.find((f) => f.endsWith('.lrc'))]
    assert.equal(path.basename(flac, '.flac'), path.basename(lrc, '.lrc'))
    if (limit === 255) assert.equal(flac, `01. ${title}.flac`)
    else assert.ok(flac.startsWith('01. A Very Long Track Title'))
  }
  setNameByteLimit(255)
})

// Hi This Is Flume, track 5: 124 characters but 319 bytes.
const FLUME_05 = '╜φ°⌂▌╫§'.repeat(17) + '╜φ°⌂▌'

test('a title far past the byte limit is restored only as far as it fits', () => {
  setNameByteLimit(255)
  const staged = `05. ${amdpCut(FLUME_05)}.flac`
  assert.ok(Buffer.byteLength(staged) <= 255)
  const restored = restoreTrackFileName(staged, FLUME_05)
  assert.ok(Buffer.byteLength(restored) <= 255, `${Buffer.byteLength(restored)} bytes`)
  assert.ok(restored.length > staged.length)
  assert.ok(restored.startsWith(staged.slice(0, -'.flac'.length)))
  assert.ok(restored.endsWith('.flac'))
})

test('the Flume track imports at both limits with its lyrics alongside', async (t) => {
  if (!hasFfmpeg) {
    t.skip('ffmpeg not available on this host')
    return
  }
  for (const limit of [255, 143]) {
    setNameByteLimit(limit)
    const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-flume-stage-'))
    const library = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-flume-lib-'))
    const staged = `05. ${amdpCut(FLUME_05)}`
    makeFlac(staging, `${staged}.flac`, FLUME_05)
    await fsp.writeFile(path.join(staging, `${staged}.lrc`), '[00:00.00]x')

    await restoreTrackFileNames(staging)
    await mergeMove(staging, library)

    const files = await fsp.readdir(library)
    assert.equal(files.length, 2)
    for (const f of files) assert.ok(Buffer.byteLength(f) <= limit, `${limit}: ${Buffer.byteLength(f)} bytes`)
    const stems = new Set(files.map((f) => path.basename(f, path.extname(f))))
    assert.equal(stems.size, 1)
  }
  setNameByteLimit(255)
})

test('the name limit is measured on the folder itself', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-probe-'))
  assert.equal(await probeNameByteLimit(dir), 255)
  assert.deepEqual(await fsp.readdir(dir), [], 'probe files are cleaned up')
  const blocked = path.join(await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-probe-')), 'file')
  await fsp.writeFile(blocked, '')
  assert.equal(await probeNameByteLimit(path.join(blocked, 'music')), null)
  assert.equal(await detectNameByteLimit([dir, path.join(blocked, 'music')]), 255)
})

test('a name-too-long failure shows a short file name, not the path', () => {
  const err = Object.assign(new Error('ENAMETOOLONG'), {
    code: 'ENAMETOOLONG',
    dest: `/tmp/alacarte-staging/job/Flume/Album/05. ${FLUME_05}.flac`,
  })
  const msg = nameTooLongMessage(err)
  assert.ok(!msg.includes('/tmp/'))
  assert.ok(msg.endsWith('….flac'))
  assert.ok(Array.from(msg).length < 90, msg)
})
