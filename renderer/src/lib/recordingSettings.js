const PREFIX = 'media-recorder:'

export const STORAGE_KEYS = {
  /** Legacy key kept for existing installs */
  saveFolder: 'save-folder',
  micId: `${PREFIX}mic-device-id`,
  cameraId: `${PREFIX}camera-device-id`,
  screenSourceId: `${PREFIX}screen-source-id`,
  quality: `${PREFIX}quality`,
  frameRate: `${PREFIX}frame-rate`,
  webcam: `${PREFIX}webcam-enabled`,
  mic: `${PREFIX}mic-enabled`,
  systemAudio: `${PREFIX}system-audio-enabled`,
  pipPosition: `${PREFIX}pip-position`,
  /** Webcam overlay: rectangle | circle */
  webcamShape: `${PREFIX}webcam-shape`,
  /** Webcam overlay size: small | medium | large */
  webcamSize: `${PREFIX}webcam-size`,
  qualityMode: `${PREFIX}quality-mode`,
  defaultExport: `${PREFIX}default-export`,
  autoCleanupDays: `${PREFIX}auto-cleanup-days`,
  /** MP4 background: auto | cpu | nvenc | qsv */
  mp4Encoder: `${PREFIX}mp4-encoder`,
  shortVideoMode: `${PREFIX}short-video-mode`,
  shortAspectRatio: `${PREFIX}short-aspect-ratio`,
  shortBackgroundMode: `${PREFIX}short-bg-mode`,
  shortZoom: `${PREFIX}short-zoom`,
}

export const DEFAULT_SETTINGS = {
  quality: '1080p',
  frameRate: 30,
  webcam: true,
  mic: true,
  systemAudio: true,
  pipPosition: 'bottom-right',
  webcamShape: 'circle',
  webcamSize: 'medium',
  qualityMode: 'balanced',
  defaultExport: 'ask',
  autoCleanupDays: null,
  mp4Encoder: 'auto',
  shortVideoMode: true,
  shortAspectRatio: '9:16',
  shortBackgroundMode: 'blur',
  shortZoom: 1,
}

export function loadString(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveString(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch { /* ignore */ }
}

export function loadBool(key, fallback) {
  const v = localStorage.getItem(key)
  if (v === null) return fallback
  return v === '1' || v === 'true'
}

export function saveBool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch { /* ignore */ }
}

export function resolutionDims(quality, qualityMode) {
  if (qualityMode === 'low') {
    return { width: 1280, height: 720 }
  }
  return quality === '720p'
    ? { width: 1280, height: 720 }
    : { width: 1920, height: 1080 }
}

export function shortAspectDims(aspectRatio = '9:16', quality = '1080p') {
  const is1080 = quality !== '720p'
  if (aspectRatio === '1:1') {
    const s = is1080 ? 1080 : 720
    return { width: s, height: s }
  }
  if (aspectRatio === '4:5') {
    return is1080 ? { width: 1080, height: 1350 } : { width: 720, height: 900 }
  }
  return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 }
}

/** Rough Mbps for UI estimates (screen + PiP composite WebM). */
export function estimateMbps(quality, qualityMode, frameRate) {
  let base = quality === '720p' ? 2.2 : 4.5
  const modeMult = { low: 0.45, balanced: 1, high: 1.65 }
  base *= modeMult[qualityMode] || 1
  if (frameRate === 60) base *= 1.35
  return base
}
