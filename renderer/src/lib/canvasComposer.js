function containRect(vw, vh, cw, ch) {
  if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch }
  const scale = Math.min(cw / vw, ch / vh)
  const w = vw * scale
  const h = vh * scale
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h }
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** @typedef {'bottom-right'|'bottom-left'|'top-right'|'top-left'|'center'} PipPreset */
/** @typedef {'rectangle'|'circle'} WebcamShape */

export function pipRectFromPreset(preset, cw, ch, marginRatio = 0.02) {
  const m = marginRatio * Math.min(cw, ch)
  const pipW = Math.round(cw * 0.22)
  const pipH = Math.round((pipW * 9) / 16)

  let x = cw - m - pipW
  let y = ch - m - pipH

  switch (preset) {
    case 'bottom-left':
      x = m
      y = ch - m - pipH
      break
    case 'top-right':
      x = cw - m - pipW
      y = m
      break
    case 'top-left':
      x = m
      y = m
      break
    case 'center':
      x = (cw - pipW) / 2
      y = (ch - pipH) / 2
      break
    case 'bottom-right':
    default:
      break
  }

  return { x, y, w: pipW, h: pipH }
}

/**
 * Draws screen + webcam PiP to a canvas and exposes captureStream().
 */
export class CanvasComposer {
  constructor({ width, height, frameRate }) {
    this.width = width
    this.height = height
    this.frameRate = frameRate
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
    if (this.canvas) {
      this.canvas.width = width
      this.canvas.height = height
      this.ctx = this.canvas.getContext('2d')
    }
    this.screenVideo = null
    this.camVideo = null
    this.webcamEnabled = true
    /** @type {WebcamShape} */
    this.pipShape = 'rectangle'
    /** @type {PipPreset} */
    this.pipPreset = 'bottom-right'
    /** Optional drag override: pixel rect {x,y,w,h} in canvas space */
    this.pipOverride = null
    this._running = false
    this._raf = 0
    this._capture = null
  }

  setVideos(screenVideo, camVideo) {
    this.screenVideo = screenVideo
    this.camVideo = camVideo
  }

  setWebcamEnabled(on) {
    this.webcamEnabled = on
  }

  /** @param {WebcamShape} shape */
  setPipShape(shape) {
    this.pipShape = shape === 'circle' ? 'circle' : 'rectangle'
  }

  setPipPreset(preset) {
    this.pipPreset = preset
  }

  setPipOverride(rect) {
    this.pipOverride = rect
  }

  start() {
    if (!this.ctx) return
    this._running = true
    const tick = () => {
      if (!this._running) return
      this.drawFrame()
      this._raf = requestAnimationFrame(tick)
    }
    this._raf = requestAnimationFrame(tick)
  }

  stop() {
    this._running = false
    cancelAnimationFrame(this._raf)
  }

  getCanvas() {
    return this.canvas
  }

  getPipRect() {
    return this.pipOverride ?? pipRectFromPreset(this.pipPreset, this.width, this.height)
  }

  getVideoStream() {
    if (!this.canvas) return null
    if (!this._capture) {
      this._capture = this.canvas.captureStream(this.frameRate)
    }
    return this._capture
  }

  drawFrame() {
    const ctx = this.ctx
    const cw = this.width
    const ch = this.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)

    const sv = this.screenVideo
    if (sv && sv.readyState >= 2) {
      const vw = sv.videoWidth
      const vh = sv.videoHeight
      const r = containRect(vw, vh, cw, ch)
      ctx.drawImage(sv, r.x, r.y, r.w, r.h)
    }

    if (!this.webcamEnabled) return

    const cv = this.camVideo
    if (!cv || cv.readyState < 2) return

    const pip = this.pipOverride ?? pipRectFromPreset(this.pipPreset, cw, ch)
    const { x, y, w, h } = pip

    ctx.save()
    if (this.pipShape === 'circle') {
      const cx = x + w / 2
      const cy = y + h / 2
      const r = Math.min(w, h) / 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(cv, x, y, w, h)
    } else {
      roundRectPath(ctx, x, y, w, h, 6)
      ctx.clip()
      ctx.drawImage(cv, x, y, w, h)
    }
    ctx.restore()

    ctx.strokeStyle = 'rgba(255,255,255,0.38)'
    ctx.lineWidth = 2
    if (this.pipShape === 'circle') {
      const cx = x + w / 2
      const cy = y + h / 2
      const r = Math.min(w, h) / 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    } else {
      roundRectPath(ctx, x, y, w, h, 6)
      ctx.stroke()
    }
  }
}
