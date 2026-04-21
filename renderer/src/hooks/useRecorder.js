import { useRef, useState, useCallback, useEffect } from 'react'
import { getDesktopMediaStream } from '../lib/desktopCapture.js'
import { createMixedAudioOutput } from '../lib/audioMix.js'
import { CanvasComposer } from '../lib/canvasComposer.js'
import { resolutionDims } from '../lib/recordingSettings.js'

export const STATES = {
  IDLE: 'idle',
  COUNTDOWN: 'countdown',
  RECORDING: 'recording',
  PAUSED: 'paused',
  SAVING: 'saving',
  EXPORT_CHOICE: 'export_choice',
  DONE: 'done',
}

function pickRecorderMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function videoBitsPerSecond(settings) {
  const qm = settings.qualityMode || 'balanced'
  let kbps = settings.quality === '720p' ? 1800 : 3500
  const m = { low: 0.55, balanced: 1, high: 1.75 }
  kbps *= m[qm] || 1
  if (settings.frameRate === 60) kbps *= 1.3
  return Math.round(kbps * 1000)
}

/**
 * Chromium often throws NotSupportedError if bitrates don't match the codec — try simpler configs.
 */
function createMediaRecorderSafe(stream, mimeType, settings) {
  const vbps = videoBitsPerSecond(settings)
  const wantAudioBits = !!(settings.mic || settings.systemAudio)

  const attempts = []
  const withMime = mimeType ? { mimeType } : {}
  attempts.push(
    wantAudioBits
      ? { ...withMime, videoBitsPerSecond: vbps, audioBitsPerSecond: 128_000 }
      : { ...withMime, videoBitsPerSecond: vbps },
  )
  attempts.push({ ...withMime, videoBitsPerSecond: vbps })
  if (wantAudioBits) {
    attempts.push({ ...withMime, audioBitsPerSecond: 128_000 })
  }
  attempts.push({ ...withMime })
  attempts.push({})

  let lastErr = null
  for (const opts of attempts) {
    try {
      const rec = new MediaRecorder(stream, opts)
      return rec
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('MediaRecorder is not supported.')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function useRecorder({
  saveFolder,
  onSaved,
  settings,
  canvasMountRef,
  defaultExport = 'ask',
}) {
  const [state, setState] = useState(STATES.IDLE)
  const [countdown, setCountdown] = useState(3)
  const [duration, setDuration] = useState(0)
  const [micLevel, setMicLevel] = useState(0)
  const [writtenBytes, setWrittenBytes] = useState(0)
  const [lastFile, setLastFile] = useState(null)
  const [lastFileSize, setLastFileSize] = useState(0)
  const [exportHint, setExportHint] = useState(null)
  const [error, setError] = useState(null)
  /** Live preview before record: screen + webcam on canvas */
  const [previewActive, setPreviewActive] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  /** Save to disk / encode progress 0–100 */
  const [saveProgress, setSaveProgress] = useState(null)
  /** Live size from encoder chunks (updated ~1s while recording). */
  const [liveChunkBytes, setLiveChunkBytes] = useState(0)
  const [highSizeRateWarning, setHighSizeRateWarning] = useState(false)
  /** Linear extrapolation: current average rate × 600s */
  const [estimatedBytes10Min, setEstimatedBytes10Min] = useState(0)
  /** Background MP4 job id after fast WebM save */
  const [lastMp4JobId, setLastMp4JobId] = useState(null)
  const [isStarting, setIsStarting] = useState(false)

  const previewBlockedRef = useRef(false)
  const previewActiveRef = useRef(false)

  const screenStreamRef = useRef(null)
  const camStreamRef = useRef(null)
  const micStreamRef = useRef(null)
  const composerRef = useRef(null)
  const recorderRef = useRef(null)
  const sessionIdRef = useRef(null)
  const appendChainRef = useRef(Promise.resolve())
  const tmpPathRef = useRef(null)
  /** Temp WebM path kept after capture stops until export finalizes (not cleared by cleanupStreams). */
  const pendingExportTmpRef = useRef(null)
  const rawBytesRef = useRef(0)
  /** Sum of MediaRecorder `Blob` chunk sizes (live capture size). */
  const chunkAccumulatedRef = useRef(0)
  const chunkBytesAtLastTickRef = useRef(0)
  const durationRef = useRef(0)
  const timerRef = useRef(null)
  const micAnimRef = useRef(null)
  const micAnalyserCtxRef = useRef(null)
  const mixAudioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const screenVideoRef = useRef(null)
  const camVideoRef = useRef(null)
  const baseNameRef = useRef('')
  const startInFlightRef = useRef(false)
  const stopInFlightRef = useRef(false)
  const mountCanvas = useCallback(
    (canvas) => {
      const mount = canvasMountRef?.current
      if (!mount || !canvas) return
      mount.innerHTML = ''
      mount.appendChild(canvas)
      canvas.style.display = 'block'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.objectFit = 'contain'
      canvas.style.background = '#000'
    },
    [canvasMountRef],
  )

  const unmountCanvas = useCallback(() => {
    const mount = canvasMountRef?.current
    const c = composerRef.current?.getCanvas?.()
    if (mount && c && c.parentNode === mount) {
      mount.removeChild(c)
    }
  }, [canvasMountRef])

  const cleanupStreams = useCallback(() => {
    clearInterval(timerRef.current)
    cancelAnimationFrame(micAnimRef.current)
    micAnalyserCtxRef.current?.close?.().catch(() => {})
    micAnalyserCtxRef.current = null
    mixAudioCtxRef.current?.close?.().catch(() => {})
    mixAudioCtxRef.current = null
    analyserRef.current = null

    composerRef.current?.stop?.()
    composerRef.current = null
    unmountCanvas()

    ;[screenStreamRef, camStreamRef, micStreamRef].forEach((r) => {
      r.current?.getTracks().forEach((t) => t.stop())
      r.current = null
    })

    recorderRef.current = null
    sessionIdRef.current = null
    tmpPathRef.current = null
  }, [unmountCanvas])

  /**
   * Stop capture sources immediately (ends Windows WGC capture session),
   * but do NOT touch the active file session / append chain.
   */
  const stopCaptureSourcesOnly = useCallback(() => {
    cancelAnimationFrame(micAnimRef.current)
    micAnalyserCtxRef.current?.close?.().catch(() => {})
    micAnalyserCtxRef.current = null
    analyserRef.current = null

    composerRef.current?.stop?.()
    composerRef.current = null
    unmountCanvas()

    ;[screenStreamRef, camStreamRef, micStreamRef].forEach((r) => {
      r.current?.getTracks().forEach((t) => t.stop())
      r.current = null
    })

    const sv = screenVideoRef.current
    if (sv) sv.srcObject = null
    const cv = camVideoRef.current
    if (cv) cv.srcObject = null
  }, [unmountCanvas])

  const cleanup = useCallback(() => {
    cleanupStreams()
    appendChainRef.current = Promise.resolve()
  }, [cleanupStreams])

  const startMicAnalyser = useCallback((micStream) => {
    cancelAnimationFrame(micAnimRef.current)
    const track = micStream?.getAudioTracks?.()[0]
    if (!track || track.readyState !== 'live') {
      setMicLevel(0)
      return
    }

    micAnalyserCtxRef.current?.close?.().catch(() => {})
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(micStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    micAnalyserCtxRef.current = ctx
    analyserRef.current = analyser

    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const n = buf[i] / 128 - 1
        sum += n * n
      }
      setMicLevel(Math.min(Math.sqrt(sum / buf.length) * 5, 1))
      micAnimRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const acquireStreams = useCallback(async () => {
    const { width, height } = resolutionDims(settings.quality, settings.qualityMode || 'balanced')
    const frameRate = settings.frameRate

    if (!settings.screenSourceId) {
      throw new Error('Select a screen or window in System input settings.')
    }
    try {
      const sources = await window.electronAPI.getDisplaySources()
      const selected = sources.some((s) => s.id === settings.screenSourceId)
      if (!selected) {
        throw new Error('Selected screen/window is no longer available. Refresh and select again.')
      }
    } catch (e) {
      if (e?.message) throw e
    }
    if (!screenVideoRef.current) {
      throw new Error('Preview is not ready. Close and reopen the recorder.')
    }

    const desktop = await getDesktopMediaStream(settings.screenSourceId, {
      width,
      height,
      frameRate,
      withSystemAudio: settings.systemAudio,
    })

    screenStreamRef.current = desktop

    let cam = null
    if (settings.webcam) {
      if (settings.cameraId) {
        const cams = await navigator.mediaDevices.enumerateDevices()
        const exists = cams.some((d) => d.kind === 'videoinput' && d.deviceId === settings.cameraId)
        if (!exists) {
          throw new Error('Selected camera is not available. Choose another camera.')
        }
      }
      try {
        cam = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: settings.cameraId ? { exact: settings.cameraId } : undefined,
            width: { ideal: 640 },
            height: { ideal: 480 },
            ...(!settings.cameraId ? { facingMode: 'user' } : {}),
          },
        })
      } catch (e) {
        throw new Error(
          e?.name === 'NotFoundError'
            ? 'No camera found. Disable webcam overlay or connect a camera.'
            : e?.message || 'Could not open camera.',
        )
      }
    }

    camStreamRef.current = cam

    let mic = null
    if (settings.mic) {
      if (settings.micId) {
        const mics = await navigator.mediaDevices.enumerateDevices()
        const exists = mics.some((d) => d.kind === 'audioinput' && d.deviceId === settings.micId)
        if (!exists) {
          throw new Error('Selected microphone is not available. Choose another microphone.')
        }
      }
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: settings.micId ? { exact: settings.micId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
          },
          video: false,
        })
      } catch (e) {
        throw new Error(
          e?.name === 'NotFoundError'
            ? 'No microphone found. Disable microphone in settings or connect a mic.'
            : e?.message || 'Could not open microphone.',
        )
      }
    }
    micStreamRef.current = mic

    const sv = screenVideoRef.current
    const cv = camVideoRef.current
    if (sv) {
      sv.srcObject = desktop
      await sv.play().catch(() => {})
    }
    if (cv) {
      cv.srcObject = cam
      await cv.play().catch(() => {})
    }

    if (settings.mic && mic) {
      startMicAnalyser(mic)
    } else {
      setMicLevel(0)
    }

    const composer = new CanvasComposer({ width, height, frameRate })
    composer.setVideos(sv, cv)
    composer.setWebcamEnabled(settings.webcam)
    composer.setPipShape(settings.webcamShape || 'rectangle')
    composer.setPipPreset(settings.pipPosition)
    composer.setPipSize(settings.webcamSize || 'medium')
    composerRef.current = composer
    composer.start()
    mountCanvas(composer.getCanvas())

    return { desktop, cam, mic, width, height, frameRate }
  }, [settings, startMicAnalyser, mountCanvas])

  const buildRecordedStream = useCallback(() => {
    const desktop = screenStreamRef.current
    const mic = micStreamRef.current
    const videoStream = composerRef.current?.getVideoStream()
    if (!videoStream) throw new Error('Compositor not ready.')

    const systemTrack =
      settings.systemAudio && desktop
        ? desktop.getAudioTracks().find((t) => t.readyState === 'live')
        : null

    const { stream: mixedAudio, audioContext } = createMixedAudioOutput({
      micStream: mic,
      systemAudioTrack: systemTrack ?? null,
      micEnabled: settings.mic,
      systemEnabled: settings.systemAudio,
    })
    mixAudioCtxRef.current?.close?.().catch(() => {})
    mixAudioCtxRef.current = audioContext

    const out = new MediaStream()
    videoStream.getVideoTracks().forEach((t) => out.addTrack(t))
    if (mixedAudio) {
      mixedAudio.getAudioTracks().forEach((t) => out.addTrack(t))
    }

    return out
  }, [settings.mic, settings.systemAudio])

  const runAutoFinalize = useCallback(
    async (action, tmpPath, baseName) => {
      setState(STATES.SAVING)
      setSaveProgress({ percent: 0, label: 'Starting…' })
      const tp = tmpPath || pendingExportTmpRef.current
      if (!tp) {
        setSaveProgress(null)
        previewBlockedRef.current = false
        setError('No recording file to save.')
        setState(STATES.IDLE)
        return
      }
      try {
        const res = await window.electronAPI.finalizeTempRecording({
          tmpPath: tp,
          destFolder: saveFolder,
          baseName,
          action: action === 'mp4' ? 'mp4' : action === 'compress-webm' ? 'compress-webm' : 'webm',
          quality: settings.qualityMode || 'balanced',
          mp4Encoder: settings.mp4Encoder || 'auto',
        })
        pendingExportTmpRef.current = null
        setSaveProgress({ percent: 100, label: 'Done' })
        if (res.success) {
          setLastFile(res.filepath)
          setLastFileSize(res.sizeBytes || 0)
          setLastMp4JobId(res.mp4JobId || null)
          setExportHint(
            res.ffmpegFailed
              ? res.message || 'Saved as WebM (FFmpeg issue).'
              : res.message || null,
          )
          onSaved?.(res.filepath)
          setState(STATES.DONE)
        } else {
          previewBlockedRef.current = false
          setError(res.error || 'Save failed.')
          setState(STATES.IDLE)
        }
      } finally {
        setTimeout(() => setSaveProgress(null), 600)
      }
    },
    [saveFolder, settings.qualityMode, settings.mp4Encoder, onSaved],
  )

  const startRecording = useCallback(async () => {
    if (state !== STATES.IDLE || startInFlightRef.current || stopInFlightRef.current) return
    startInFlightRef.current = true
    setIsStarting(true)
    previewBlockedRef.current = true
    setError(null)
    rawBytesRef.current = 0
    setWrittenBytes(0)
    chunkAccumulatedRef.current = 0
    chunkBytesAtLastTickRef.current = 0
    durationRef.current = 0
    setLiveChunkBytes(0)
    setHighSizeRateWarning(false)
    setEstimatedBytes10Min(0)
    setLastMp4JobId(null)

    if (!saveFolder) {
      previewBlockedRef.current = false
      setError('Choose a save folder from the title bar before recording.')
      startInFlightRef.current = false
      setIsStarting(false)
      return
    }

    if (!window.electronAPI?.recordingSessionStart) {
      previewBlockedRef.current = false
      setError('Recorder API is unavailable. Restart the app.')
      startInFlightRef.current = false
      setIsStarting(false)
      return
    }

    let ok = false
    try {
      ok = await window.electronAPI.folderExists(saveFolder)
    } catch (e) {
      previewBlockedRef.current = false
      setError(e?.message || 'Could not verify save folder.')
      startInFlightRef.current = false
      setIsStarting(false)
      return
    }
    if (!ok) {
      previewBlockedRef.current = false
      setError('Save folder is missing or invalid. Pick another folder.')
      startInFlightRef.current = false
      setIsStarting(false)
      return
    }

    let disk = { ok: true }
    try {
      disk = await window.electronAPI.canStartRecording(saveFolder)
    } catch {
      disk = { ok: true }
    }
    if (!disk.ok) {
      previewBlockedRef.current = false
      setError(disk.message || 'Not enough free disk space to record.')
      startInFlightRef.current = false
      setIsStarting(false)
      return
    }

    try {
      const reusePreview = previewActiveRef.current
      if (reusePreview) {
        previewActiveRef.current = false
        setPreviewActive(false)
      } else {
        await acquireStreams()
      }
      console.info('[Recorder] Streams initialized')

      const sess = await window.electronAPI.recordingSessionStart()
      if (!sess?.sessionId) {
        throw new Error('Could not start file session.')
      }
      sessionIdRef.current = sess.sessionId
      tmpPathRef.current = sess.tmpPath

      setState(STATES.COUNTDOWN)
      setCountdown(3)

      for (let i = 3; i >= 1; i--) {
        setCountdown(i)
        await sleep(1000)
      }

      const finalStream = buildRecordedStream()
      const mimeType = pickRecorderMimeType()
      const recorder = createMediaRecorderSafe(finalStream, mimeType, settings)
      recorderRef.current = recorder

      const sid = sessionIdRef.current

      appendChainRef.current = Promise.resolve()

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return
        chunkAccumulatedRef.current += e.data.size
        appendChainRef.current = appendChainRef.current.then(async () => {
          const ab = await e.data.arrayBuffer()
          const res = await window.electronAPI.recordingSessionAppend({
            sessionId: sid,
            buffer: ab,
          })
          if (!res.ok && res.error === 'disk_full') {
            setError('Disk full — stopping recording.')
            try {
              recorder.stop()
            } catch { /* ignore */ }
            return
          }
          if (res.ok && typeof res.totalBytes === 'number') {
            rawBytesRef.current = res.totalBytes
            setWrittenBytes(res.totalBytes)
          }
        })
      }

      recorder.onerror = () => {
        setError('Recording was interrupted.')
      }

      recorder.start(400)
      console.info('[Recorder] Stream started, MediaRecorder running')

      baseNameRef.current = `recording-${Date.now()}`
      setState(STATES.RECORDING)
      setDuration(0)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)

    } catch (err) {
      if (sessionIdRef.current) {
        try {
          await window.electronAPI.recordingSessionEnd(sessionIdRef.current)
        } catch { /* ignore */ }
      }
      if (tmpPathRef.current) {
        await window.electronAPI.discardTempRecording(tmpPathRef.current)
      }
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Permission denied for screen, camera, or microphone.'
          : err?.message || 'Could not start recording.'
      setError(msg)
      previewBlockedRef.current = false
      cleanup()
      setState(STATES.IDLE)
    } finally {
      startInFlightRef.current = false
      setIsStarting(false)
    }
  }, [state, saveFolder, acquireStreams, buildRecordedStream, cleanup, settings])

  const togglePause = useCallback(() => {
    const rec = recorderRef.current
    if (!rec) return
    if (state === STATES.RECORDING) {
      rec.pause()
      clearInterval(timerRef.current)
      setState(STATES.PAUSED)
    } else if (state === STATES.PAUSED) {
      rec.resume()
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000)
      setState(STATES.RECORDING)
    }
  }, [state])

  const stopRecording = useCallback(() => {
    if (stopInFlightRef.current) return
    const rec = recorderRef.current
    if (!rec) return
    stopInFlightRef.current = true
    clearInterval(timerRef.current)
    cancelAnimationFrame(micAnimRef.current)
    setSaveProgress({ percent: 0, label: 'Stopping recorder…' })
    setState(STATES.SAVING)

    const sid = sessionIdRef.current
    const baseName = baseNameRef.current || `recording-${Date.now()}`

    rec.onstop = () => {
      appendChainRef.current
        .then(() => window.electronAPI.recordingSessionEnd(sid))
        .then(async (endRes) => {
          if (!endRes.ok) {
            setError('Could not finalize capture file.')
            setSaveProgress(null)
            previewBlockedRef.current = false
            cleanupStreams()
            setState(STATES.IDLE)
            stopInFlightRef.current = false
            return
          }
          pendingExportTmpRef.current = endRes.tmpPath
          setWrittenBytes(endRes.totalBytes || 0)
          cleanupStreams()

          const exp = defaultExport === 'ask' ? 'ask' : defaultExport
          if (exp === 'webm') {
            await runAutoFinalize('webm', endRes.tmpPath, baseName)
            return
          }
          if (exp === 'mp4') {
            await runAutoFinalize('mp4', endRes.tmpPath, baseName)
            return
          }

          const mb = (endRes.totalBytes || 0) / (1024 * 1024)
          setExportHint(mb > 80 ? 'Large file — consider compressing to WebM or a lower quality preset.' : null)
          setSaveProgress(null)
          setState(STATES.EXPORT_CHOICE)
        })
        .catch(() => {
          setError('Failed to write recording.')
          setSaveProgress(null)
          previewBlockedRef.current = false
          cleanupStreams()
          setState(STATES.IDLE)
          stopInFlightRef.current = false
        })
        .finally(() => {
          stopInFlightRef.current = false
        })
    }

    try {
      // Prompt a final chunk, then stop.
      try {
        rec.requestData?.()
      } catch { /* ignore */ }
      rec.stop()
      // Immediately stop capture tracks so Windows WGC doesn't keep reading frames/logging errors.
      stopCaptureSourcesOnly()
    } catch {
      setError('Failed to stop recorder.')
      setSaveProgress(null)
      previewBlockedRef.current = false
      cleanup()
      setState(STATES.IDLE)
      stopInFlightRef.current = false
    }
  }, [cleanup, cleanupStreams, runAutoFinalize, defaultExport, stopCaptureSourcesOnly])

  const finalizeExport = useCallback(
    async (action) => {
      await runAutoFinalize(action, pendingExportTmpRef.current, baseNameRef.current)
    },
    [runAutoFinalize],
  )

  const discardRecording = useCallback(async () => {
    const tp = pendingExportTmpRef.current
    if (tp) await window.electronAPI.discardTempRecording(tp)
    pendingExportTmpRef.current = null
    previewBlockedRef.current = false
    cleanup()
    setState(STATES.IDLE)
    setWrittenBytes(0)
  }, [cleanup])

  const reset = useCallback(() => {
    previewBlockedRef.current = false
    cleanup()
    setState(STATES.IDLE)
    setDuration(0)
    setMicLevel(0)
    setWrittenBytes(0)
    setLastFile(null)
    setLastFileSize(0)
    setExportHint(null)
    pendingExportTmpRef.current = null
    setError(null)
    setSaveProgress(null)
    setLiveChunkBytes(0)
    setHighSizeRateWarning(false)
    setEstimatedBytes10Min(0)
    setLastMp4JobId(null)
    chunkAccumulatedRef.current = 0
    chunkBytesAtLastTickRef.current = 0
    startInFlightRef.current = false
    stopInFlightRef.current = false
  }, [cleanup])

  const stopPreviewOnly = useCallback(() => {
    previewActiveRef.current = false
    setPreviewActive(false)
    setPreviewError(null)
    cleanupStreams()
    appendChainRef.current = Promise.resolve()
  }, [cleanupStreams])

  const startPreview = useCallback(async () => {
    if (previewBlockedRef.current) return
    if (!settings.screenSourceId) return
    try {
      setPreviewError(null)
      await stopPreviewOnly()
      await acquireStreams()
      previewActiveRef.current = true
      setPreviewActive(true)
    } catch (e) {
      const msg = e?.message || 'Could not start preview.'
      setPreviewError(msg)
      previewActiveRef.current = false
      setPreviewActive(false)
    }
  }, [acquireStreams, settings.screenSourceId, stopPreviewOnly])

  const previewKey = [
    settings.screenSourceId,
    settings.quality,
    settings.qualityMode || 'balanced',
    settings.frameRate,
    settings.webcam,
    settings.webcamShape,
    settings.webcamSize,
    settings.mic,
    settings.cameraId,
    settings.micId,
    settings.systemAudio,
    settings.pipPosition,
  ].join('|')

  useEffect(() => {
    if (state !== STATES.IDLE) return undefined
    if (previewBlockedRef.current) return undefined
    const id = setTimeout(() => {
      if (previewBlockedRef.current) return
      startPreview()
    }, 450)
    return () => clearTimeout(id)
  }, [state, previewKey, startPreview])

  useEffect(() => {
    const unsub = window.electronAPI?.onFinalizeSaveProgress?.((d) => {
      setSaveProgress({ percent: d.percent, label: d.label || '' })
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    composerRef.current?.setPipShape?.(settings.webcamShape || 'rectangle')
  }, [settings.webcamShape])

  useEffect(() => {
    composerRef.current?.setPipSize?.(settings.webcamSize || 'medium')
  }, [settings.webcamSize])

  useEffect(() => {
    durationRef.current = duration
  }, [duration])

  useEffect(() => {
    if (state !== STATES.RECORDING && state !== STATES.PAUSED) return
    const id = setInterval(() => setWrittenBytes(rawBytesRef.current), 500)
    return () => clearInterval(id)
  }, [state])

  useEffect(() => {
    if (state !== STATES.RECORDING && state !== STATES.PAUSED) {
      setLiveChunkBytes(0)
      setHighSizeRateWarning(false)
      setEstimatedBytes10Min(0)
      return undefined
    }
    chunkBytesAtLastTickRef.current = chunkAccumulatedRef.current
    const id = setInterval(() => {
      const total = chunkAccumulatedRef.current
      const prev = chunkBytesAtLastTickRef.current
      chunkBytesAtLastTickRef.current = total
      setLiveChunkBytes(total)
      const delta = total - prev
      const mbPerSec = delta / (1024 * 1024)
      const baseThresh = settings.quality === '720p' ? 2.8 : 4.2
      const modeAdj = settings.qualityMode === 'high' ? 0.85 : settings.qualityMode === 'low' ? 1.15 : 1
      setHighSizeRateWarning(mbPerSec > baseThresh * modeAdj)
      const dur = Math.max(1, durationRef.current)
      const rate = total / dur
      setEstimatedBytes10Min(rate * 600)
    }, 1000)
    return () => clearInterval(id)
  }, [state, settings.quality, settings.qualityMode])

  const updatePipDrag = useCallback((clientX, clientY, containerRect) => {
    const comp = composerRef.current
    if (!comp) return
    const canvas = comp.getCanvas()
    if (!canvas) return

    const cw = canvas.width
    const ch = canvas.height
    const scale = Math.min(containerRect.width / cw, containerRect.height / ch)
    const drawW = cw * scale
    const drawH = ch * scale
    const offX = containerRect.left + (containerRect.width - drawW) / 2
    const offY = containerRect.top + (containerRect.height - drawH) / 2

    const lx = (clientX - offX) / scale
    const ly = (clientY - offY) / scale

    const base = comp.getPipRect()
    const w = base.w
    const h = base.h
    let x = Math.round(lx - w / 2)
    let y = Math.round(ly - h / 2)
    const margin = 8
    x = Math.max(margin, Math.min(cw - w - margin, x))
    y = Math.max(margin, Math.min(ch - h - margin, y))
    comp.setPipOverride({ x, y, w, h })
  }, [])

  const getPipRect = useCallback(() => {
    return composerRef.current?.getPipRect?.() ?? null
  }, [])

  const applyPipPreset = useCallback((preset) => {
    const comp = composerRef.current
    if (!comp) return
    comp.setPipPreset(preset)
    comp.setPipOverride(null)
  }, [])

  const setMicMuted = useCallback((muted) => {
    const tracks = micStreamRef.current?.getAudioTracks?.() || []
    tracks.forEach((t) => {
      t.enabled = !muted
    })
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  return {
    state,
    countdown,
    duration,
    micLevel,
    writtenBytes,
    lastFile,
    lastFileSize,
    exportHint,
    error,
    previewActive,
    previewError,
    saveProgress,
    liveChunkBytes,
    highSizeRateWarning,
    estimatedBytes10Min,
    lastMp4JobId,
    screenStreamRef,
    camStreamRef,
    micStreamRef,
    screenVideoRef,
    camVideoRef,
    startRecording,
    togglePause,
    stopRecording,
    reset,
    finalizeExport,
    discardRecording,
    updatePipDrag,
    getPipRect,
    applyPipPreset,
    setMicMuted,
    isStarting,
  }
}
