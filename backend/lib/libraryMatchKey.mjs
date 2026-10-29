/**
 * Shared library presence / Qobuz write-path title normalizer.
 * Match keys always run through normalizeForMatchKey; write-time renaming
 * only applies when namingConvention === 'qobuz'.
 */

const BAD_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

const QUOTE_MAP = new Map([
  ['\u2018', "'"], // ‘
  ['\u2019', "'"], // ’
  ['\u201C', '"'], // “
  ['\u201D', '"'], // ”
  ['\u2032', "'"], // ′
  ['\u2033', '"'], // ″
  ['`', "'"],
])

// Trailing feat / ft / featuring in () or []
const TRAILING_FEAT_RE =
  /\s+[\(\[](?:feat\.|ft\.|featuring)[^\)\]]*[\)\]]\s*$/i

// Octo ResolveUniquePath duplicate: "Title (2)" — 1–2 digits only so years survive
const DUPLICATE_COUNTER_RE = /\s+\((\d{1,2})\)\s*$/

// amdp choice tags on filenames
const EXPLICIT_TAG_RE = /\s*\[[ECM]\]\s*$/i

// Apple product-type album suffixes (hyphen, en-dash, or em-dash)
const PRODUCT_TYPE_SUFFIX_RE =
  /\s+[\u2013\u2014\-]\s+(?:Single|EP|Remix|Soundtrack)\s*$/i

const YEAR_SUFFIX_RE = /\s*[([]\d{4}[)\]]\s*$/

// Filesystems cap a name in bytes, not characters: 255 on most, about 143 on
// eCryptfs (e.g. Synology encrypted shares). CJK and symbol characters take
// 2-4 bytes each, so a character cap alone is not enough. The limit is
// measured on the music and staging folders at startup (see
// detectNameByteLimit), so write paths and match keys cut names the same way.
const MIN_NAME_BYTES = 64
let nameByteLimit = 255

export function setNameByteLimit(limit) {
  const n = Math.floor(Number(limit))
  if (n >= MIN_NAME_BYTES) nameByteLimit = Math.min(n, 255)
}

export function getNameByteLimit() {
  return nameByteLimit
}

// Folders leave room for a version suffix like " (Atmos)".
const FOLDER_SUFFIX_RESERVE = 25
// Longest extension a track and its sidecars use (.flac, .ttml, .m3u8).
const MAX_EXT_BYTES = 5

function truncateBytes(s, maxBytes) {
  if (Buffer.byteLength(s) <= maxBytes) return s
  const chars = Array.from(s)
  let bytes = Buffer.byteLength(s)
  while (chars.length && bytes > maxBytes) bytes -= Buffer.byteLength(chars.pop())
  return chars.join('').replace(/\.+$/g, '').trim()
}

export function sanitizeSegment(name) {
  if (!name) return '_'
  let s = String(name)
    .replace(BAD_CHARS, '_')
    .replace(/\.+$/g, '')
    .trim()
    .slice(0, 200)
  s = truncateBytes(s, nameByteLimit - FOLDER_SUFFIX_RESERVE)
  return s || '_'
}

/**
 * Shortens a file name to fit the byte limit, keeping its extension. The cut
 * depends on the stem alone, so a track and its .lrc/.ttml sidecars always
 * end up with the same stem.
 */
export function fitFileName(fileName) {
  const ext = /\.[^.]{1,4}$/.exec(fileName)?.[0] || ''
  const stem = fileName.slice(0, fileName.length - ext.length)
  const budget = nameByteLimit - MAX_EXT_BYTES
  if (Buffer.byteLength(stem) <= budget) return fileName
  return `${truncateBytes(stem, budget) || '_'}${ext}`
}

// amdp cuts names by character count. Worst case 4 bytes per character plus
// a track number and extension still has to fit the byte limit.
export function amdpNameCharLimit() {
  return Math.floor((nameByteLimit - 10) / 4)
}

// amdp's own replacement for characters it cannot put in a path.
const AMDP_FORBIDDEN = /[/\\<>:"|?*]/g

/**
 * amdp names its folders and files from Apple metadata, cut to
 * amdpNameCharLimit() characters. When stagedName is that cut-down copy of
 * fullName, returns the name amdp would have written without the cut;
 * otherwise stagedName unchanged.
 */
export function restoreTruncatedName(stagedName, fullName) {
  if (!stagedName || !fullName) return stagedName
  const full = String(fullName).replace(AMDP_FORBIDDEN, '_')
  const chars = Array.from(full)
  if (chars.length <= amdpNameCharLimit()) return stagedName
  const cut = chars.slice(0, amdpNameCharLimit()).join('').trim()
  return cut === String(stagedName).trim() ? full.trim() : stagedName
}

function mapQuotes(input) {
  let out = ''
  for (const ch of input) {
    out += QUOTE_MAP.get(ch) ?? ch
  }
  return out
}

/**
 * Normalize a title (album or song) for comparison / presence keys.
 * Does not strip deluxe, remaster, live, or version parentheticals.
 */
export function normalizeForMatchKey(name) {
  if (!name) return ''
  let s = String(name).normalize('NFKC')
  s = mapQuotes(s)
  s = s.replace(/\s+/g, ' ').trim()

  // Loop-strip trailing feat tags (Octo style)
  while (true) {
    const next = s.replace(TRAILING_FEAT_RE, '').trim()
    if (next === s) break
    s = next
  }

  s = s.replace(DUPLICATE_COUNTER_RE, '').trim()
  s = s.replace(EXPLICIT_TAG_RE, '').trim()
  s = s.replace(PRODUCT_TYPE_SUFFIX_RE, '').trim()
  return s
}

export function stripTrailingYear(title) {
  if (!title) return ''
  return String(title).replace(YEAR_SUFFIX_RE, '').trim()
}

/**
 * Write-path Qobuz renaming: strip feat + product-type suffixes.
 * Does not NFKC/quote-normalize the display name beyond those strips.
 */
export function applyQobuzWriteNaming(name) {
  if (!name) return name
  let s = String(name)
  s = s.replace(/\s+[\(\[](?:feat\.|ft\.|featuring)[^\)\]]*[\)\]]/gi, '').trim()
  s = s.replace(PRODUCT_TYPE_SUFFIX_RE, '').trim()
  return s
}

export function makeAlbumMatchKey(artistName, albumName) {
  const artistKey = sanitizeSegment(normalizeForMatchKey(artistName)).toLowerCase()
  const albumKey = sanitizeSegment(
    normalizeForMatchKey(stripTrailingYear(albumName)),
  ).toLowerCase()
  if (!artistKey || !albumKey || artistKey === '_' || albumKey === '_') return ''
  return `${artistKey}::${albumKey}`
}

export function makeSongMatchKey(artistName, songName) {
  const artistKey = sanitizeSegment(normalizeForMatchKey(artistName)).toLowerCase()
  const songKey = sanitizeSegment(normalizeForMatchKey(songName)).toLowerCase()
  if (!artistKey || !songKey || artistKey === '_' || songKey === '_') return ''
  return `${artistKey}::${songKey}`
}

/**
 * Album presence fallback for multi-artist releases: the album part must
 * match exactly while the artist parts are token subsets of each other
 * ("denzel curry" vs "denzel curry & kenny beats"). Keys are
 * `<artist>::<album>`; ':' never survives sanitization, so '::' is safe
 * to split on.
 */
export function isAlbumKeyVariantMatch(existingKeys, key) {
  const sep = key.lastIndexOf('::')
  if (sep <= 0 || sep + 2 >= key.length) return false
  const artistKey = key.slice(0, sep)
  const albumKey = key.slice(sep + 2)
  const artistTokens = new Set(artistKey.split(' ').filter(Boolean))
  if (artistTokens.size === 0) return false
  for (const existing of existingKeys) {
    const existingSep = existing.lastIndexOf('::')
    if (existingSep <= 0 || existingSep + 2 >= existing.length) continue
    if (existing.slice(existingSep + 2) !== albumKey) continue
    const existingTokens = existing.slice(0, existingSep).split(' ').filter(Boolean)
    if (existingTokens.length === 0) continue
    const subset =
      existingTokens.every((t) => artistTokens.has(t)) ||
      [...artistTokens].every((t) => existingTokens.includes(t))
    if (subset) return true
  }
  return false
}
