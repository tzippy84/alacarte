// Post-download export hook.
//
// After a job has put its files into the library, this copies each NEW
// .m4a/.m4p file, runs a cleanup script on the copy (default: strips Apple
// catalog atoms with AtomicParsley) and drops the result into an export
// folder. The library file itself is never touched, so ALACarte keeps its
// ISRC/UPC tags for duplicate detection.
//
// Disabled unless POST_EXPORT_ENABLED=true. Failures are logged and never
// fail the download job.
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

const EXPORT_EXT = /\.(m4a|m4p)$/i
const AUDIO_EXT = /\.(flac|m4a|mp3|m4p)$/i
const MAX_NAME_BYTES = 200

export function hookConfig(env = process.env) {
  return {
    enabled: String(env.POST_EXPORT_ENABLED || '').trim().toLowerCase() === 'true',
    exportDir: env.POST_EXPORT_DIR || '/export',
    script: env.POST_EXPORT_SCRIPT || '/app/hooks/atome_entfernen.sh',
    musicRoot: env.AMDL_MUSIC_PATH || '/music',
    timeoutMs: Number(env.POST_EXPORT_TIMEOUT_MS) || 60_000,
  }
}

// Relative paths (to `dir`) of all audio files below it. Call this BEFORE the
// files are moved out of the staging folder.
export async function listAudioRel(dir) {
  const out = []
  async function walk(abs, rel) {
    const entries = await fsp.readdir(abs, { withFileTypes: true })
    for (const e of entries) {
      const nextAbs = path.join(abs, e.name)
      const nextRel = rel ? path.join(rel, e.name) : e.name
      if (e.isDirectory()) await walk(nextAbs, nextRel)
      else if (AUDIO_EXT.test(e.name)) out.push(nextRel)
    }
  }
  await walk(dir, '')
  return out
}

// "/music/Artist/Album (2020)/01 Song.m4a" -> "Artist - Album (2020) - 01 Song.m4a"
// A flat, unique name, so equal track names from different albums do not clash.
export function exportFileName(file, musicRoot) {
  const rel = path.relative(musicRoot, file)
  const base = path.basename(file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return base
  const name = rel.split(path.sep).join(' - ')
  if (Buffer.byteLength(name) <= MAX_NAME_BYTES) return name
  const hash = crypto.createHash('sha1').update(rel).digest('hex').slice(0, 8)
  return `${hash} - ${base}`
}

function runScript(script, file, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('bash', [script, file], { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${err.message}\n${String(stderr || stdout || '').trim()}`.trim()
        reject(err)
      } else resolve()
    })
  })
}

export async function runPostDownloadHook(job, files, { config = hookConfig(), run = runScript } = {}) {
  const result = { exported: 0, failed: 0 }
  if (!config.enabled) return result
  try {
    const candidates = [...new Set((files || []).filter((f) => EXPORT_EXT.test(f)))]
    if (candidates.length === 0) return result
    const tmpDir = path.join(config.exportDir, '.tmp')
    await fsp.mkdir(tmpDir, { recursive: true })
    for (const file of candidates) {
      const tmp = path.join(tmpDir, `${crypto.randomUUID()}${path.extname(file).toLowerCase()}`)
      try {
        const st = await fsp.stat(file)
        if (!st.isFile()) continue
        await fsp.copyFile(file, tmp)
        await run(config.script, tmp, config.timeoutMs)
        // tmpDir and exportDir share a filesystem, so this rename is atomic:
        // the consumer never sees a half-written file.
        await fsp.rename(tmp, path.join(config.exportDir, exportFileName(file, config.musicRoot)))
        result.exported += 1
      } catch (err) {
        result.failed += 1
        console.error(`[job ${job?.id}] export hook failed for ${path.basename(file)}: ${err.message}`)
        await fsp.rm(tmp, { force: true }).catch(() => {})
      }
    }
    if (result.exported || result.failed) {
      console.log(`[job ${job?.id}] export hook: ${result.exported} exported, ${result.failed} failed`)
    }
  } catch (err) {
    console.error(`[job ${job?.id}] export hook error: ${err.message}`)
  }
  return result
}
