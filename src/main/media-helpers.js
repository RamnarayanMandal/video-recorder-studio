const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const _cds = require('check-disk-space')
const checkDiskSpace = typeof _cds === 'function' ? _cds : _cds.default

const VIDEO_EXT = /\.(webm|mp4|mkv)$/i
const META_NAME = '.media-recorder-meta.json'

// ✅ FIX: ffmpeg-static asar ke andar band ho jaata hai Windows pe
// isliye app.asar ko app.asar.unpacked se replace karna zaroori hai
function ffExecutable(ffmpegPath) {
  if (!ffmpegPath) return null
  const p = String(ffmpegPath)

  // asar.unpacked path banao
  const unpacked = p.includes('app.asar')
    ? p.replace('app.asar', 'app.asar.unpacked')
    : p

  // Windows pe .exe extension bhi check karo
  const candidates = [
    unpacked,
    unpacked + '.exe',
    p,
    p + '.exe',
  ]

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch { /* ignore */ }
  }

  // Koi bhi exist nahi karta toh unpacked path return karo (error aage handle hoga)
  return unpacked
}

async function getDriveStats(folderPath) {
  try {
    const disk = await checkDiskSpace(folderPath)
    return {
      totalBytes: disk.size,
      freeBytes: disk.free,
      usedBytes: disk.size - disk.free,
      usedPercent: disk.size > 0 ? Math.round(((disk.size - disk.free) / disk.size) * 100) : 0,
    }
  } catch {
    return null
  }
}

function sumFolderVideoBytes(folderPath) {
  let total = 0
  if (!folderPath || !fs.existsSync(folderPath)) return total
  try {
    const names = fs.readdirSync(folderPath)
    for (const name of names) {
      if (name.startsWith('.')) continue
      const fp = path.join(folderPath, name)
      const st = fs.statSync(fp)
      if (st.isFile() && VIDEO_EXT.test(name)) total += st.size
    }
  } catch { /* ignore */ }
  return total
}

function parseDurationFromFfprobe_stderr(stderr) {
  const m = /Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/.exec(stderr || '')
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = parseFloat(m[3])
  return h * 3600 + min * 60 + sec
}

function probeDuration(ffPath, filepath) {
  const r = spawnSync(ffPath, ['-i', filepath, '-hide_banner'], {
    encoding: 'utf-8',
    maxBuffer: 5 * 1024 * 1024,
  })
  return parseDurationFromFfprobe_stderr(r.stderr || r.stdout || '')
}

function metaPath(folder) {
  return path.join(folder, META_NAME)
}

function readMeta(folder) {
  try {
    const p = metaPath(folder)
    if (!fs.existsSync(p)) {
      return { version: 1, recordingTags: {}, autoCleanupDays: null }
    }
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    return {
      version: 1,
      recordingTags: j.recordingTags || {},
      autoCleanupDays: j.autoCleanupDays ?? null,
    }
  } catch {
    return { version: 1, recordingTags: {}, autoCleanupDays: null }
  }
}

function writeMeta(folder, meta) {
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(metaPath(folder), JSON.stringify(meta, null, 2), 'utf8')
}

function generateThumbnailDataUrl(ffPath, filepath, osTmp, randomUUID) {
  const tmpPng = path.join(osTmp, `mr-thumb-${randomUUID()}.png`)
  try {
    const r = spawnSync(
      ffPath,
      ['-y', '-ss', '00:00:01', '-i', filepath, '-vframes', '1', '-vf', 'scale=320:-1', tmpPng],
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    )
    if (r.status !== 0 || !fs.existsSync(tmpPng)) return null
    const b64 = fs.readFileSync(tmpPng).toString('base64')
    return `data:image/png;base64,${b64}`
  } catch {
    return null
  } finally {
    try {
      if (fs.existsSync(tmpPng)) fs.unlinkSync(tmpPng)
    } catch { /* ignore */ }
  }
}

/** Quality: low | balanced | high — maps to CRF / compression */
function buildMp4Args(inputPath, outputPath, quality) {
  const crf = { low: 28, balanced: 23, high: 18 }[quality] || 23
  const preset = quality === 'high' ? 'slow' : 'fast'
  return [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', quality === 'low' ? '96k' : '128k',
    '-movflags', '+faststart',
    outputPath,
  ]
}

/**
 * Background MP4 (WebM input): libx264 veryfast + CRF 28 baseline,
 * or h264_nvenc / h264_qsv when selected.
 * @param {'libx264'|'h264_nvenc'|'h264_qsv'} videoCodec
 */
function buildBackgroundMp4Args(inputPath, outputPath, videoCodec, quality) {
  const crf = { low: 30, balanced: 28, high: 23 }[quality] || 28
  const qsvQ = { low: 32, balanced: 28, high: 24 }[quality] || 28
  const aac = ['-c:a', 'aac', '-b:a', '128k']
  const tail = ['-movflags', '+faststart', outputPath]
  if (videoCodec === 'h264_nvenc') {
    return [
      '-y', '-i', inputPath,
      '-c:v', 'h264_nvenc',
      '-preset', 'p4',
      '-cq', String(crf),
      '-pix_fmt', 'yuv420p',
      ...aac,
      ...tail,
    ]
  }
  if (videoCodec === 'h264_qsv') {
    return [
      '-y', '-i', inputPath,
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      '-global_quality', String(qsvQ),
      '-pix_fmt', 'yuv420p',
      ...aac,
      ...tail,
    ]
  }
  return [
    '-y', '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    ...aac,
    ...tail,
  ]
}

function listFfmpegVideoEncoders(ffPath) {
  if (!ffPath || !fs.existsSync(ffPath)) return { nvenc: false, qsv: false }
  try {
    const r = spawnSync(ffPath, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })
    const text = `${r.stdout || ''}\n${r.stderr || ''}`
    return {
      nvenc: /\bh264_nvenc\b/.test(text),
      qsv: /\bh264_qsv\b/.test(text),
    }
  } catch {
    return { nvenc: false, qsv: false }
  }
}

function buildCompressWebmArgs(inputPath, outputPath, quality) {
  const crf = { low: 42, balanced: 36, high: 30 }[quality] || 36
  return [
    '-y',
    '-i', inputPath,
    '-c:v', 'libvpx',
    '-quality', 'good',
    '-cpu-used', '4',
    '-crf', String(crf),
    '-b:v', '0',
    '-c:a', 'libopus',
    '-b:a', '64k',
    outputPath,
  ]
}

module.exports = {
  ffExecutable,
  getDriveStats,
  sumFolderVideoBytes,
  probeDuration,
  readMeta,
  writeMeta,
  metaPath,
  generateThumbnailDataUrl,
  buildMp4Args,
  buildBackgroundMp4Args,
  listFfmpegVideoEncoders,
  buildCompressWebmArgs,
  VIDEO_EXT,
}