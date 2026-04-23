const {
  app, BrowserWindow, ipcMain, desktopCapturer,
  systemPreferences, session, dialog, shell,
} = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { randomUUID } = require('crypto')
const { spawnSync } = require('child_process')
const { copyFileWithProgress, runFfmpegWithProgress } = require('./finalize-save.js')
const { ConversionQueue } = require('./conversion-queue.js')
const ffmpegPath = require('ffmpeg-static')
const {
  ffExecutable,
  getDriveStats,
  sumFolderVideoBytes,
  probeDuration,
  readMeta,
  writeMeta,
  generateThumbnailDataUrl,
  buildMp4Args,
  buildCompressWebmArgs,
} = require('./media-helpers.js')

const ff = () => ffExecutable(ffmpegPath)

/** Min free space before blocking a new recording (can be tight on small SSDs). */
const MIN_FREE_BYTES = 150 * 1024 * 1024
const WARN_DRIVE_PERCENT = 80

const recordingSessions = new Map()

/** Lazy-init so ff path is correct after unpack. */
let conversionQueue = null
function getConversionQueue() {
  const f = ff()
  if (!conversionQueue) {
    conversionQueue = new ConversionQueue({ ffPath: f, maxConcurrent: 2 })
  } else {
    conversionQueue.refreshFfPath(f)
  }
  return conversionQueue
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

let mainWindow = null
let overlayWindow = null
let overlayConfig = {
  active: false,
  screenSourceId: '',
  cameraId: '',
  webcam: true,
  webcamShape: 'rectangle',
  webcamSize: 'medium',
}

async function requestMacPermissions() {
  if (process.platform !== 'darwin') return
  const cam = systemPreferences.getMediaAccessStatus('camera')
  if (cam !== 'granted') await systemPreferences.askForMediaAccess('camera')
  const mic = systemPreferences.getMediaAccessStatus('microphone')
  if (mic !== 'granted') await systemPreferences.askForMediaAccess('microphone')
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(['media', 'display-capture', 'audioCapture', 'videoCapture'].includes(permission))
  })
  session.defaultSession.setPermissionCheckHandler((wc, permission) =>
    ['media', 'display-capture', 'audioCapture', 'videoCapture'].includes(permission),
  )

  isDev
    ? win.loadURL('http://localhost:5173')
    : win.loadFile(path.join(__dirname, '../../renderer/dist/index.html'))
  mainWindow = win
  return win
}

function sendOverlayConfig() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send('overlay-config', overlayConfig)
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show()
    overlayWindow.focus()
    sendOverlayConfig()
    return overlayWindow
  }
  overlayWindow = new BrowserWindow({
    width: 420,
    height: 260,
    minWidth: 280,
    minHeight: 180,
    maxWidth: 1400,
    maxHeight: 900,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      additionalArguments: ['--window-role=overlay'],
    },
  })
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  // Prevent overlay from appearing inside captured screen frames (black blocking rectangle).
  overlayWindow.setContentProtection(true)

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173/overlay')
  } else {
    const overlayHtml = path.join(__dirname, '../../renderer/dist/overlay.html')
    const indexHtml = path.join(__dirname, '../../renderer/dist/index.html')
    if (fs.existsSync(overlayHtml)) overlayWindow.loadFile(overlayHtml)
    else overlayWindow.loadFile(indexHtml, { hash: 'overlay' })
  }

  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive()
    sendOverlayConfig()
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  return overlayWindow
}

ipcMain.handle('get-primary-screen', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'], thumbnailSize: { width: 1, height: 1 },
  })
  return sources[0]?.id ?? null
})

ipcMain.handle('get-display-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'], thumbnailSize: { width: 320, height: 200 },
  })
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
    display_id: s.display_id,
  }))
})

ipcMain.handle('overlay-open', async () => {
  createOverlayWindow()
  // Keep main window visible to avoid compositor throttling/freezing while recording.
  // Minimizing can pause renderer-driven canvas updates on some systems.
  return { ok: true }
})

ipcMain.handle('overlay-close', async () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  overlayWindow = null
  return { ok: true }
})

ipcMain.handle('overlay-config-set', async (event, partial) => {
  overlayConfig = { ...overlayConfig, ...(partial || {}) }
  if (!overlayConfig.active) {
    if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
    overlayWindow = null
    return { ok: true, closed: true }
  }
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow()
  sendOverlayConfig()
  return { ok: true }
})

ipcMain.handle('overlay-move-by', async (event, { dx = 0, dy = 0 }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false }
  const b = win.getBounds()
  win.setBounds({ x: Math.round(b.x + dx), y: Math.round(b.y + dy), width: b.width, height: b.height })
  return { ok: true }
})

ipcMain.handle('overlay-resize-by', async (event, { dw = 0, dh = 0 }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false }
  const b = win.getBounds()
  const width = Math.max(280, Math.round(b.width + dw))
  const height = Math.max(180, Math.round(b.height + dh))
  win.setBounds({ ...b, width, height })
  return { ok: true }
})

ipcMain.handle('overlay-center', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { ok: false }
  if (mainWindow && !mainWindow.isDestroyed()) {
    const mb = mainWindow.getBounds()
    const wb = win.getBounds()
    win.setBounds({
      ...wb,
      x: Math.round(mb.x + (mb.width - wb.width) / 2),
      y: Math.round(mb.y + 80),
    })
  } else {
    win.center()
  }
  return { ok: true }
})

ipcMain.handle('overlay-stop-recording', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay-action', { type: 'stop-recording' })
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.close()
  overlayWindow = null
  return { ok: true }
})

ipcMain.handle('overlay-toggle-mic', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay-action', { type: 'toggle-mic' })
  }
  return { ok: true }
})

ipcMain.handle('overlay-toggle-pause', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('overlay-action', { type: 'toggle-pause' })
  }
  return { ok: true }
})

ipcMain.handle('pick-save-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose recordings folder',
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('folder-exists', async (event, folderPath) => {
  try {
    return !!(folderPath && fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory())
  } catch {
    return false
  }
})

ipcMain.handle('get-storage-stats', async (event, folder) => {
  if (!folder || !fs.existsSync(folder)) {
    return {
      folderBytes: 0,
      driveTotalBytes: 0,
      driveFreeBytes: 0,
      driveUsedPercent: 0,
      warnings: [],
    }
  }
  const drive = await getDriveStats(folder)
  const folderBytes = sumFolderVideoBytes(folder)
  const warnings = []
  if (drive) {
    if (drive.usedPercent >= WARN_DRIVE_PERCENT) {
      warnings.push({ type: 'drive_usage', message: `Drive is ${drive.usedPercent}% full.` })
    }
    if (drive.freeBytes < MIN_FREE_BYTES) {
      warnings.push({ type: 'low_space', message: 'Very low disk space.' })
    }
  }
  return {
    folderBytes,
    driveTotalBytes: drive?.totalBytes ?? 0,
    driveFreeBytes: drive?.freeBytes ?? 0,
    driveUsedPercent: drive?.usedPercent ?? 0,
    warnings,
  }
})

ipcMain.handle('can-start-recording', async (event, folder) => {
  try {
    if (!folder) return { ok: false, reason: 'no_folder' }
    const drive = await getDriveStats(folder)
    if (!drive) return { ok: true }
    if (drive.freeBytes < MIN_FREE_BYTES) {
      return {
        ok: false,
        reason: 'low_space',
        message: `Need at least ${Math.round(MIN_FREE_BYTES / (1024 * 1024))} MB free to record safely.`,
      }
    }
    return { ok: true, freeBytes: drive.freeBytes }
  } catch {
    return { ok: true }
  }
})

ipcMain.handle('recording-session-start', async () => {
  const id = randomUUID()
  const tmpPath = path.join(os.tmpdir(), `mr-${id}.webm`)
  const ws = fs.createWriteStream(tmpPath)
  recordingSessions.set(id, { ws, tmpPath, bytes: 0, ended: false })
  return { sessionId: id, tmpPath }
})

ipcMain.handle('recording-session-append', async (event, { sessionId, buffer }) => {
  const entry = recordingSessions.get(sessionId)
  if (!entry || entry.ended) return { ok: false, error: 'invalid_session' }
  const folder = path.parse(entry.tmpPath).root
  const drive = await getDriveStats(folder)
  const buf = Buffer.from(buffer)
  if (drive && drive.freeBytes < buf.length + 50 * 1024 * 1024) {
    try {
      entry.ws.destroy()
    } catch { /* ignore */ }
    entry.ended = true
    recordingSessions.delete(sessionId)
    try {
      if (fs.existsSync(entry.tmpPath)) fs.unlinkSync(entry.tmpPath)
    } catch { /* ignore */ }
    return { ok: false, error: 'disk_full' }
  }
  return new Promise((resolve, reject) => {
    entry.ws.write(buf, (err) => {
      if (err) return reject(err)
      entry.bytes += buf.length
      resolve({ ok: true, totalBytes: entry.bytes })
    })
  })
})

ipcMain.handle('discard-temp-recording', async (event, tmpPath) => {
  try {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    return { ok: true }
  } catch {
    return { ok: false }
  }
})

ipcMain.handle('recording-session-end', async (event, sessionId) => {
  const entry = recordingSessions.get(sessionId)
  if (!entry) return { ok: false, error: 'invalid_session' }
  entry.ended = true
  return new Promise((resolve) => {
    entry.ws.end(() => {
      recordingSessions.delete(sessionId)
      const exists = fs.existsSync(entry.tmpPath)
      resolve({
        ok: true,
        tmpPath: entry.tmpPath,
        totalBytes: entry.bytes,
        partial: exists ? entry.bytes > 0 : false,
      })
    })
  })
})

ipcMain.handle('mp4-encoder-capabilities', async () => {
  return getConversionQueue().getEncoderCapabilities()
})

ipcMain.handle('cancel-mp4-conversion', async (event, jobId) => {
  return getConversionQueue().cancel(jobId)
})

ipcMain.handle('retry-mp4-conversion', async (event, jobId) => {
  return getConversionQueue().retry(jobId)
})

ipcMain.handle('finalize-temp-recording', async (event, opts) => {
  const {
    tmpPath,
    destFolder,
    baseName,
    action,
    quality = 'balanced',
    mp4Encoder = 'auto',
  } = opts
  const f = ff()
  if (!tmpPath || !fs.existsSync(tmpPath)) {
    return { success: false, error: 'Temporary recording is missing.' }
  }
  fs.mkdirSync(destFolder, { recursive: true })
  const safeBase = (baseName || `recording-${Date.now()}`).replace(/[^\w.\-]+/g, '_')

  const durationHint = f && fs.existsSync(f) ? probeDuration(f, tmpPath) : 0

  try {
    if (action === 'webm') {
      const out = path.join(destFolder, `${safeBase}.webm`)
      await copyFileWithProgress(event, tmpPath, out)
      try {
        fs.unlinkSync(tmpPath)
      } catch { /* ignore */ }
      const st = fs.statSync(out)
      return { success: true, filepath: out, sizeBytes: st.size, format: 'webm' }
    }

    if (action === 'mp4') {
      const webmOut = path.join(destFolder, `${safeBase}.webm`)
      const mp4Out = path.join(destFolder, `${safeBase}.mp4`)
      if (!f || !fs.existsSync(f)) {
        await copyFileWithProgress(event, tmpPath, webmOut)
        try {
          fs.unlinkSync(tmpPath)
        } catch { /* ignore */ }
        return {
          success: true,
          filepath: webmOut,
          sizeBytes: fs.statSync(webmOut).size,
          format: 'webm',
          ffmpegFailed: true,
          message: 'FFmpeg missing — saved as WebM only (no background MP4).',
        }
      }
      await copyFileWithProgress(event, tmpPath, webmOut)
      try {
        fs.unlinkSync(tmpPath)
      } catch { /* ignore */ }
      const st = fs.statSync(webmOut)
      const jobId = getConversionQueue().enqueue({
        inputPath: webmOut,
        outputPath: mp4Out,
        quality,
        encoderPreference: mp4Encoder,
      })
      return {
        success: true,
        filepath: webmOut,
        sizeBytes: st.size,
        format: 'webm',
        mp4JobId: jobId,
        mp4PathPending: mp4Out,
        message: 'WebM saved. MP4 is converting in the background.',
      }
    }

    if (action === 'compress-webm') {
      const out = path.join(destFolder, `${safeBase}-compressed.webm`)
      if (!f || !fs.existsSync(f)) {
        const fb = path.join(destFolder, `${safeBase}.webm`)
        await copyFileWithProgress(event, tmpPath, fb)
        try {
          fs.unlinkSync(tmpPath)
        } catch { /* ignore */ }
        return {
          success: true,
          filepath: fb,
          sizeBytes: fs.statSync(fb).size,
          format: 'webm',
          ffmpegFailed: true,
        }
      }
      const args = buildCompressWebmArgs(tmpPath, out, quality)
      try {
        await runFfmpegWithProgress(f, args, event, durationHint || 120, 'Compressing WebM')
        try {
          fs.unlinkSync(tmpPath)
        } catch { /* ignore */ }
        if (fs.existsSync(out)) {
          const st = fs.statSync(out)
          return { success: true, filepath: out, sizeBytes: st.size, format: 'webm-compressed' }
        }
      } catch { /* fallback */ }
      const fb = path.join(destFolder, `${safeBase}.webm`)
      await copyFileWithProgress(event, tmpPath, fb)
      try {
        fs.unlinkSync(tmpPath)
      } catch { /* ignore */ }
      return {
        success: true,
        filepath: fb,
        sizeBytes: fs.statSync(fb).size,
        format: 'webm',
        ffmpegFailed: true,
      }
    }

    return { success: false, error: 'Unknown export action.' }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        const emergency = path.join(destFolder, `${safeBase}-recovered.webm`)
        await copyFileWithProgress(event, tmpPath, emergency)
        try {
          fs.unlinkSync(tmpPath)
        } catch { /* ignore */ }
        return { success: true, filepath: emergency, sizeBytes: fs.statSync(emergency).size, recovered: true }
      }
    } catch { /* ignore */ }
    return { success: false, error: err.message }
  }
})

ipcMain.handle('compress-video-file', async (event, { filepath, quality = 'balanced' }) => {
  const f = ff()
  if (!f || !fs.existsSync(f)) {
    return { success: false, error: 'FFmpeg not available.' }
  }
  const dir = path.dirname(filepath)
  const ext = path.extname(filepath)
  const base = path.basename(filepath, ext)
  const out = path.join(dir, `${base}-compressed${ext === '.webm' ? '.webm' : '.mp4'}`)
  const args =
    ext.toLowerCase() === '.webm'
      ? buildCompressWebmArgs(filepath, out, quality)
      : buildMp4Args(filepath, out, quality)
  const r = spawnSync(f, args, { encoding: 'utf-8', maxBuffer: 40 * 1024 * 1024 })
  if (r.status !== 0) return { success: false, error: (r.stderr || '').slice(-500) }
  return { success: true, filepath: out, sizeBytes: fs.statSync(out).size }
})

ipcMain.handle('delete-files', async (event, filePaths) => {
  let deleted = 0
  for (const fp of filePaths || []) {
    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp)
        deleted++
      }
    } catch { /* ignore */ }
  }
  return { deleted }
})

ipcMain.handle('list-recordings-detailed', async (event, folder, options = {}) => {
  const { withThumbnails = false, limit = 120 } = options
  if (!folder || !fs.existsSync(folder)) return []
  const meta = readMeta(folder)
  const ffBin = ff()
  let entries = []
  try {
    const names = fs.readdirSync(folder)
    for (const name of names) {
      if (name.startsWith('.')) continue
      if (!/\.(webm|mp4)$/i.test(name)) continue
      const fp = path.join(folder, name)
      const stat = fs.statSync(fp)
      if (!stat.isFile()) continue
      let durationSec = null
      if (ffBin && fs.existsSync(ffBin)) {
        durationSec = probeDuration(ffBin, fp)
      }
      entries.push({
        name,
        filepath: fp,
        size: stat.size,
        mtime: stat.mtimeMs,
        durationSec,
        tag: meta.recordingTags[name] || '',
      })
    }
  } catch {
    return []
  }
  entries.sort((a, b) => b.mtime - a.mtime)
  entries = entries.slice(0, limit)
  if (withThumbnails && ffBin && fs.existsSync(ffBin)) {
    entries = entries.map((e) => ({
      ...e,
      thumbnailDataUrl: generateThumbnailDataUrl(ffBin, e.filepath, os.tmpdir(), randomUUID),
    }))
  }
  return entries
})

ipcMain.handle('library-meta-get', async (event, folder) => readMeta(folder))

ipcMain.handle('library-meta-set', async (event, { folder, meta }) => {
  const cur = readMeta(folder)
  writeMeta(folder, { ...cur, ...meta })
  return { ok: true }
})

ipcMain.handle('library-set-tag', async (event, { folder, filename, tag }) => {
  const meta = readMeta(folder)
  meta.recordingTags = meta.recordingTags || {}
  if (tag) meta.recordingTags[filename] = tag
  else delete meta.recordingTags[filename]
  writeMeta(folder, meta)
  return { ok: true }
})

ipcMain.handle('library-auto-cleanup', async (event, { folder, maxAgeDays }) => {
  if (!maxAgeDays || !folder || !fs.existsSync(folder)) return { removed: 0 }
  const cutoff = Date.now() - maxAgeDays * 864e5
  let removed = 0
  const names = fs.readdirSync(folder)
  for (const name of names) {
    if (!/\.(webm|mp4)$/i.test(name)) continue
    const fp = path.join(folder, name)
    try {
      const st = fs.statSync(fp)
      if (st.mtimeMs < cutoff && st.isFile()) {
        fs.unlinkSync(fp)
        removed++
      }
    } catch { /* ignore */ }
  }
  return { removed }
})

ipcMain.handle('open-file', async (event, filepath) => {
  await shell.openPath(filepath)
})

ipcMain.handle('open-folder', async (event, folderPath) => {
  try {
    await shell.openPath(folderPath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('show-item-in-folder', async (event, filepath) => {
  try {
    shell.showItemInFolder(filepath)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('list-recordings', async (event, folder) => {
  try {
    if (!folder || !fs.existsSync(folder)) return []
    return fs.readdirSync(folder)
      .filter((f) => f.endsWith('.webm') || f.endsWith('.mp4'))
      .map((f) => {
        const fp = path.join(folder, f)
        const stat = fs.statSync(fp)
        return { name: f, filepath: fp, size: stat.size, mtime: stat.mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
  } catch {
    return []
  }
})

app.whenReady().then(async () => {
  await requestMacPermissions()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
