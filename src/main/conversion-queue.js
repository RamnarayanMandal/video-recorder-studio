const fs = require('fs')
const { spawn } = require('child_process')
const { randomUUID } = require('crypto')
const { BrowserWindow } = require('electron')
const { probeDuration, buildBackgroundMp4Args, listFfmpegVideoEncoders } = require('./media-helpers')

function parseFfmpegTime(line) {
  const m = /time=(\d{2}):(\d{2}):(\d{2}\.\d+)/.exec(line)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const sec = parseFloat(m[3])
  return h * 3600 + min * 60 + sec
}

function broadcastJob(job) {
  const payload = { job: { ...job } }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed()) win.webContents.send('conversion-job-update', payload)
    } catch {
      /* ignore */
    }
  }
}

class ConversionQueue {
  /**
   * @param {{ ffPath: string | null, maxConcurrent?: number }} opts
   */
  constructor(opts) {
    this.ffPath = opts.ffPath || null
    this.maxConcurrent = opts.maxConcurrent ?? 2
    /** @type {string[]} */
    this.waiting = []
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.active = new Map()
    /** @type {Map<string, object>} */
    this.jobs = new Map()
    this.encoderCaps = null
  }

  refreshFfPath(ffPath) {
    this.ffPath = ffPath || null
    this.encoderCaps = null
  }

  getEncoderCapabilities() {
    if (!this.encoderCaps) {
      this.encoderCaps = listFfmpegVideoEncoders(this.ffPath)
    }
    return this.encoderCaps
  }

  /**
   * @param {'auto'|'cpu'|'nvenc'|'qsv'} preference
   */
  resolveVideoCodec(preference) {
    const cap = this.getEncoderCapabilities()
    const p = preference || 'auto'
    if (p === 'nvenc' && cap.nvenc) return 'h264_nvenc'
    if (p === 'qsv' && cap.qsv) return 'h264_qsv'
    if (p === 'cpu') return 'libx264'
    if (p === 'auto') {
      if (cap.nvenc) return 'h264_nvenc'
      if (cap.qsv) return 'h264_qsv'
    }
    return 'libx264'
  }

  /**
   * @returns {string} job id
   */
  enqueue({ inputPath, outputPath, quality, encoderPreference }) {
    const id = randomUUID()
    const job = {
      id,
      status: 'queued',
      percent: 0,
      label: 'Queued for MP4…',
      inputPath,
      outputPath,
      quality: quality || 'balanced',
      encoderPreference: encoderPreference || 'auto',
      videoCodec: null,
      error: null,
      mp4Path: null,
      mp4SizeBytes: 0,
    }
    this.jobs.set(id, job)
    this.waiting.push(id)
    broadcastJob(job)
    this.pump()
    return id
  }

  pump() {
    while (this.active.size < this.maxConcurrent && this.waiting.length) {
      const id = this.waiting.shift()
      this.runJob(id)
    }
  }

  runJob(id) {
    const job = this.jobs.get(id)
    if (!job || job.status === 'cancelled') {
      this.pump()
      return
    }

    if (!this.ffPath || !fs.existsSync(this.ffPath)) {
      job.status = 'failed'
      job.error = 'FFmpeg not available.'
      broadcastJob(job)
      this.pump()
      return
    }

    if (!fs.existsSync(job.inputPath)) {
      job.status = 'failed'
      job.error = 'WebM file is missing.'
      broadcastJob(job)
      this.pump()
      return
    }

    const videoCodec = this.resolveVideoCodec(job.encoderPreference)
    job.videoCodec = videoCodec
    job.status = 'running'
    job.percent = 0
    job.label = `Optimizing video (${videoCodec})…`
    broadcastJob(job)

    const durationSec = probeDuration(this.ffPath, job.inputPath) || 120
    const args = buildBackgroundMp4Args(job.inputPath, job.outputPath, videoCodec, job.quality)

    const proc = spawn(this.ffPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    this.active.set(id, proc)

    let stderrBuf = ''
    proc.stderr.on('data', (d) => {
      stderrBuf += d.toString()
      const lines = stderrBuf.split('\n')
      stderrBuf = lines.pop() || ''
      for (const line of lines) {
        const t = parseFfmpegTime(line)
        if (t != null && durationSec > 0.5) {
          const pct = Math.min(99, Math.round((t / durationSec) * 100))
          job.percent = pct
          job.label = `Optimizing video… ${pct}%`
          broadcastJob(job)
        }
      }
    })

    proc.on('error', (e) => {
      this.active.delete(id)
      job.status = 'failed'
      job.error = e.message || 'FFmpeg failed to start.'
      broadcastJob(job)
      this.pump()
    })

    proc.on('close', (code) => {
      this.active.delete(id)
      if (code === 0 && fs.existsSync(job.outputPath)) {
        job.status = 'completed'
        job.percent = 100
        job.label = 'MP4 ready'
        job.mp4Path = job.outputPath
        try {
          job.mp4SizeBytes = fs.statSync(job.outputPath).size
        } catch {
          job.mp4SizeBytes = 0
        }
      } else {
        job.status = 'failed'
        job.error =
          code !== 0
            ? `Conversion failed (exit ${code}). Original WebM is unchanged.`
            : 'Output file missing.'
      }
      broadcastJob(job)
      this.pump()
    })
  }

  cancel(id) {
    const job = this.jobs.get(id)
    if (!job) return { ok: false }
    const wi = this.waiting.indexOf(id)
    if (wi >= 0) this.waiting.splice(wi, 1)
    const proc = this.active.get(id)
    if (proc) {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ignore */
      }
      this.active.delete(id)
    }
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'cancelled'
      job.label = 'Cancelled'
      broadcastJob(job)
    }
    this.pump()
    return { ok: true }
  }

  retry(id) {
    const job = this.jobs.get(id)
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) {
      return { ok: false, error: 'Nothing to retry.' }
    }
    if (!fs.existsSync(job.inputPath)) {
      return { ok: false, error: 'WebM source file is missing.' }
    }
    try {
      if (fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath)
    } catch {
      /* ignore */
    }
    job.status = 'queued'
    job.percent = 0
    job.label = 'Queued for MP4…'
    job.error = null
    job.mp4Path = null
    job.mp4SizeBytes = 0
    this.waiting.push(id)
    broadcastJob(job)
    this.pump()
    return { ok: true }
  }
}

module.exports = { ConversionQueue }
