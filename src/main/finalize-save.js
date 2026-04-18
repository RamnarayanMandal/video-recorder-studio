const fs = require('fs')
const { spawn } = require('child_process')

function sendProgress(event, percent, label) {
  try {
    const sender = event?.sender
    if (!sender) return
    if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) return
    sender.send('finalize-save-progress', {
      percent: Math.max(0, Math.min(100, Math.round(percent))),
      label: label || '',
    })
  } catch { /* window may be gone */ }
}

function parseFfmpegTime(line) {
  const m = /time=(\d{2}):(\d{2}):(\d{2}\.\d+)/.exec(line)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = parseFloat(m[3])
  return h * 3600 + min * 60 + sec
}

/**
 * Copy file with byte progress (0–100%).
 */
function copyFileWithProgress(event, srcPath, destPath) {
  return new Promise((resolve, reject) => {
    let size = 0
    try {
      size = fs.statSync(srcPath).size
    } catch (e) {
      return reject(e)
    }
    if (size === 0) {
      sendProgress(event, 50, 'Saving…')
      try {
        fs.copyFileSync(srcPath, destPath)
      } catch (e) {
        return reject(e)
      }
      sendProgress(event, 100, 'Saved')
      return resolve()
    }

    let written = 0
    const rs = fs.createReadStream(srcPath, { highWaterMark: 4 * 1024 * 1024 })
    const ws = fs.createWriteStream(destPath)

    rs.on('data', (chunk) => {
      written += chunk.length
      const pct = Math.min(99, (written / size) * 100)
      sendProgress(event, pct, `Saving file… ${Math.round(pct)}%`)
    })
    rs.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', () => {
      sendProgress(event, 100, 'Saved')
      resolve()
    })
    rs.pipe(ws)
  })
}

/**
 * Run ffmpeg with stderr time-based progress when durationSec > 0.
 */
function runFfmpegWithProgress(ffmpegPath, args, event, durationSec, phaseLabel) {
  return new Promise((resolve, reject) => {
    sendProgress(event, 2, `${phaseLabel}…`)
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderrBuf = ''
    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() || ''
      for (const line of lines) {
        const t = parseFfmpegTime(line)
        if (t != null && durationSec > 0.5) {
          const pct = Math.min(99, 5 + (t / durationSec) * 94)
          sendProgress(event, pct, `${phaseLabel}… ${Math.round((t / durationSec) * 100)}%`)
        }
      }
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        sendProgress(event, 100, 'Complete')
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with ${code}`))
      }
    })
  })
}

module.exports = {
  sendProgress,
  copyFileWithProgress,
  runFfmpegWithProgress,
}
