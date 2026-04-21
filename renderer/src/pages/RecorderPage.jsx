import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useRecorder, STATES } from '../hooks/useRecorder.js'
import { useConversionJobsStore } from '../stores/conversionJobsStore.js'
import { formatRecordingSize } from '../lib/formatRecordingSize.js'
import {
  STORAGE_KEYS,
  DEFAULT_SETTINGS,
  loadString,
  saveString,
  loadBool,
  saveBool,
  estimateMbps,
} from '../lib/recordingSettings.js'

function fmtHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return [h, m, ss].map((n) => String(n).padStart(2, '0')).join(':')
}

function MicBars({ level }) {
  const bars = 8
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 18 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = (i + 1) / bars
        const active = level >= threshold
        return (
          <div
            key={i}
            style={{
              width: 3,
              height: 4 + i * 1.6,
              borderRadius: 2,
              background: active
                ? (level > 0.8 ? 'var(--red)' : level > 0.5 ? 'var(--amber)' : 'var(--green)')
                : 'var(--bg4)',
              transition: 'background .08s',
            }}
          />
        )
      })}
    </div>
  )
}

function loadInitialSettings() {
  const fr = loadString(STORAGE_KEYS.frameRate)
  const de = loadString(STORAGE_KEYS.defaultExport)
  const ac = loadString(STORAGE_KEYS.autoCleanupDays)
  return {
    quality: loadString(STORAGE_KEYS.quality) || DEFAULT_SETTINGS.quality,
    frameRate: fr === '60' ? 60 : 30,
    qualityMode: ['low', 'balanced', 'high'].includes(loadString(STORAGE_KEYS.qualityMode))
      ? loadString(STORAGE_KEYS.qualityMode)
      : DEFAULT_SETTINGS.qualityMode,
    defaultExport: ['ask', 'webm', 'mp4'].includes(de) ? de : DEFAULT_SETTINGS.defaultExport,
    mp4Encoder: ['auto', 'cpu', 'nvenc', 'qsv'].includes(loadString(STORAGE_KEYS.mp4Encoder))
      ? loadString(STORAGE_KEYS.mp4Encoder)
      : DEFAULT_SETTINGS.mp4Encoder,
    autoCleanupDays: ac ? Number(ac) : null,
    webcam: loadBool(STORAGE_KEYS.webcam, DEFAULT_SETTINGS.webcam),
    mic: loadBool(STORAGE_KEYS.mic, DEFAULT_SETTINGS.mic),
    systemAudio: loadBool(STORAGE_KEYS.systemAudio, DEFAULT_SETTINGS.systemAudio),
    pipPosition: loadString(STORAGE_KEYS.pipPosition) || DEFAULT_SETTINGS.pipPosition,
    webcamShape: ['rectangle', 'circle'].includes(loadString(STORAGE_KEYS.webcamShape))
      ? loadString(STORAGE_KEYS.webcamShape)
      : DEFAULT_SETTINGS.webcamShape,
    webcamSize: ['small', 'medium', 'large'].includes(loadString(STORAGE_KEYS.webcamSize))
      ? loadString(STORAGE_KEYS.webcamSize)
      : DEFAULT_SETTINGS.webcamSize,
    micId: loadString(STORAGE_KEYS.micId),
    cameraId: loadString(STORAGE_KEYS.cameraId),
    screenSourceId: loadString(STORAGE_KEYS.screenSourceId),
  }
}

function formatSizeBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function RecorderPage({ saveFolder, onBack, onSaved }) {
  const [settings, setSettings] = useState(loadInitialSettings)
  const [encoderCaps, setEncoderCaps] = useState({ nvenc: false, qsv: false })
  const [panelOpen, setPanelOpen] = useState(true)
  const [displaySources, setDisplaySources] = useState([])
  const [audioInputs, setAudioInputs] = useState([])
  const [videoInputs, setVideoInputs] = useState([])
  const [pipDragging, setPipDragging] = useState(false)
  const [toolbarOffset, setToolbarOffset] = useState({ x: 0, y: 0 })
  const [toolbarDragging, setToolbarDragging] = useState(false)
  const toolbarDragRef = useRef(null)

  const canvasMountRef = useRef(null)
  const previewWrapRef = useRef(null)

  const recorder = useRecorder({
    saveFolder,
    onSaved,
    settings,
    canvasMountRef,
    defaultExport: settings.defaultExport || 'ask',
  })

  const {
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
  } = recorder

  const mp4Job = useConversionJobsStore((s) => {
    const id = lastMp4JobId
    if (!id) return null
    return s.jobsById[id] || null
  })

  const busy =
    state === STATES.COUNTDOWN ||
    state === STATES.RECORDING ||
    state === STATES.PAUSED ||
    state === STATES.SAVING
  const lockDeviceInputs =
    state === STATES.COUNTDOWN ||
    state === STATES.RECORDING ||
    state === STATES.PAUSED

  const isExportChoice = state === STATES.EXPORT_CHOICE

  const patchSettings = useCallback((partial) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      if (partial.quality !== undefined) saveString(STORAGE_KEYS.quality, next.quality)
      if (partial.frameRate !== undefined) saveString(STORAGE_KEYS.frameRate, String(next.frameRate))
      if (partial.webcam !== undefined) saveBool(STORAGE_KEYS.webcam, next.webcam)
      if (partial.mic !== undefined) saveBool(STORAGE_KEYS.mic, next.mic)
      if (partial.systemAudio !== undefined) saveBool(STORAGE_KEYS.systemAudio, next.systemAudio)
      if (partial.pipPosition !== undefined) saveString(STORAGE_KEYS.pipPosition, next.pipPosition)
      if (partial.webcamShape !== undefined) saveString(STORAGE_KEYS.webcamShape, next.webcamShape)
      if (partial.webcamSize !== undefined) saveString(STORAGE_KEYS.webcamSize, next.webcamSize)
      if (partial.micId !== undefined) saveString(STORAGE_KEYS.micId, next.micId)
      if (partial.cameraId !== undefined) saveString(STORAGE_KEYS.cameraId, next.cameraId)
      if (partial.screenSourceId !== undefined) saveString(STORAGE_KEYS.screenSourceId, next.screenSourceId)
      if (partial.qualityMode !== undefined) saveString(STORAGE_KEYS.qualityMode, next.qualityMode)
      if (partial.defaultExport !== undefined) saveString(STORAGE_KEYS.defaultExport, next.defaultExport)
      if (partial.mp4Encoder !== undefined) saveString(STORAGE_KEYS.mp4Encoder, next.mp4Encoder)
      if (partial.autoCleanupDays !== undefined) {
        if (next.autoCleanupDays == null) saveString(STORAGE_KEYS.autoCleanupDays, '')
        else saveString(STORAGE_KEYS.autoCleanupDays, String(next.autoCleanupDays))
      }
      return next
    })
  }, [])

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setAudioInputs(list.filter((d) => d.kind === 'audioinput'))
      setVideoInputs(list.filter((d) => d.kind === 'videoinput'))
    } catch {
      setAudioInputs([])
      setVideoInputs([])
    }
  }, [])

  const refreshDisplaySources = useCallback(async () => {
    try {
      const src = await window.electronAPI.getDisplaySources()
      setDisplaySources(src)
      return src
    } catch {
      setDisplaySources([])
      return []
    }
  }, [])

  useEffect(() => {
    window.electronAPI?.mp4EncoderCapabilities?.().then(setEncoderCaps).catch(() => {
      setEncoderCaps({ nvenc: false, qsv: false })
    })
  }, [])

  useEffect(() => {
    refreshDevices()
    refreshDisplaySources().then((src) => {
      if (!settings.screenSourceId && src.length) {
        const first = src.find((s) => s.name?.toLowerCase().includes('screen')) || src[0]
        if (first?.id) patchSettings({ screenSourceId: first.id })
      }
    })
    const onDev = () => refreshDevices()
    navigator.mediaDevices.addEventListener('devicechange', onDev)
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDev)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!displaySources.length) return
    if (displaySources.some((s) => s.id === settings.screenSourceId)) return
    const first = displaySources.find((s) => s.name?.toLowerCase().includes('screen')) || displaySources[0]
    if (first?.id) patchSettings({ screenSourceId: first.id })
  }, [displaySources, settings.screenSourceId, patchSettings])

  useEffect(() => {
    const active =
      state === STATES.COUNTDOWN ||
      state === STATES.RECORDING ||
      state === STATES.PAUSED
    if (active) window.electronAPI?.overlayOpen?.().catch(() => {})
    else window.electronAPI?.overlayClose?.().catch(() => {})
    window.electronAPI
      ?.overlayConfigSet?.({
        active,
        durationSec: duration,
        micLevel,
        isPaused: state === STATES.PAUSED,
        micEnabled: !!settings.mic,
        screenSourceId: settings.screenSourceId,
        cameraId: settings.cameraId || '',
        webcam: !!settings.webcam,
        webcamShape: settings.webcamShape || 'rectangle',
        webcamSize: settings.webcamSize || 'medium',
      })
      .catch(() => {})
  }, [
    state,
    duration,
    micLevel,
    settings.mic,
    settings.screenSourceId,
    settings.cameraId,
    settings.webcam,
    settings.webcamShape,
    settings.webcamSize,
  ])

  useEffect(() => {
    const unsub = window.electronAPI?.onOverlayAction?.((event) => {
      if (!event?.type) return
      if (event.type === 'stop-recording') {
        if (state === STATES.RECORDING || state === STATES.PAUSED) stopRecording()
        return
      }
      if (event.type === 'toggle-pause') {
        if (state === STATES.RECORDING || state === STATES.PAUSED) togglePause()
        return
      }
      if (event.type === 'toggle-mic') {
        const nextMic = !settings.mic
        patchSettings({ mic: nextMic })
        setMicMuted(!nextMic)
      }
    })
    return () => unsub?.()
  }, [state, settings.mic, patchSettings, setMicMuted, stopRecording, togglePause])

  const pipHitTest = useCallback(
    (clientX, clientY) => {
      const wrap = previewWrapRef.current
      const pip = getPipRect()
      if (!wrap || !pip) return false
      const rect = wrap.getBoundingClientRect()
      const canvas = canvasMountRef.current?.querySelector('canvas')
      if (!canvas) return false
      const cw = canvas.width
      const ch = canvas.height
      const scale = Math.min(rect.width / cw, rect.height / ch)
      const drawW = cw * scale
      const drawH = ch * scale
      const ox = rect.left + (rect.width - drawW) / 2
      const oy = rect.top + (rect.height - drawH) / 2
      const left = ox + pip.x * scale
      const top = oy + pip.y * scale
      const w = pip.w * scale
      const h = pip.h * scale
      if (settings.webcamShape === 'circle') {
        const cx = left + w / 2
        const cy = top + h / 2
        const r = Math.min(w, h) / 2
        const dx = clientX - cx
        const dy = clientY - cy
        return dx * dx + dy * dy <= r * r
      }
      return clientX >= left && clientX <= left + w && clientY >= top && clientY <= top + h
    },
    [getPipRect, settings.webcamShape],
  )

  const onPipPointerDown = useCallback(
    (e) => {
      if (!settings.webcam) return
      const previewIdle = state === STATES.IDLE && previewActive
      if (
        state !== STATES.RECORDING &&
        state !== STATES.COUNTDOWN &&
        state !== STATES.PAUSED &&
        !previewIdle
      )
        return
      if (!pipHitTest(e.clientX, e.clientY)) return
      e.preventDefault()
      setPipDragging(true)
    },
    [settings.webcam, state, previewActive, pipHitTest],
  )

  useEffect(() => {
    if (!pipDragging) return
    const onMove = (e) => {
      const wrap = previewWrapRef.current
      if (!wrap) return
      updatePipDrag(e.clientX, e.clientY, wrap.getBoundingClientRect())
    }
    const onUp = () => setPipDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [pipDragging, updatePipDrag])

  useEffect(() => {
    if (!toolbarDragging) return
    const onMove = (e) => {
      if (!toolbarDragRef.current) return
      const { startX, startY, startOffsetX, startOffsetY } = toolbarDragRef.current
      setToolbarOffset({
        x: startOffsetX + (e.clientX - startX),
        y: startOffsetY + (e.clientY - startY),
      })
    }
    const onUp = () => {
      setToolbarDragging(false)
      toolbarDragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [toolbarDragging])

  const isLive = state === STATES.RECORDING || state === STATES.PAUSED
  const isCountdown = state === STATES.COUNTDOWN
  const isDone = state === STATES.DONE
  const isSaving = state === STATES.SAVING
  const isIdle = state === STATES.IDLE

  const savePct =
    saveProgress != null && typeof saveProgress.percent === 'number' && !Number.isNaN(saveProgress.percent)
      ? Math.min(100, Math.max(0, saveProgress.percent))
      : 0
  const saveLabel =
    (saveProgress?.label && String(saveProgress.label).trim()) || 'Saving recording…'

  const est10MinMB =
    ((estimateMbps(settings.quality, settings.qualityMode, settings.frameRate) * 600) / 8).toFixed(0)

  const recordingSizeToolbar = useMemo(
    () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 2,
          minWidth: 92,
          maxWidth: 200,
        }}
      >
        <span
          title="Size of encoded chunks (live). Disk line shows bytes written."
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatRecordingSize(liveChunkBytes)}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>disk {formatSizeBytes(writtenBytes)}</span>
        {estimatedBytes10Min > 512 * 1024 ? (
          <span style={{ fontSize: 10, color: 'var(--text3)' }}>
            ~{formatRecordingSize(estimatedBytes10Min)} / 10 min (trend)
          </span>
        ) : null}
        {highSizeRateWarning ? (
          <span style={{ fontSize: 10, color: 'var(--amber)', textAlign: 'right', lineHeight: 1.3 }}>
            High file size rate — consider lowering quality
          </span>
        ) : null}
      </div>
    ),
    [liveChunkBytes, writtenBytes, estimatedBytes10Min, highSizeRateWarning],
  )

  const panelStyle = useMemo(
    () => ({
      width: panelOpen ? 280 : 44,
      flexShrink: 0,
      background: 'var(--bg2)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      transition: 'width .22s ease',
      overflow: 'hidden',
    }),
    [panelOpen],
  )

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
      {/* Settings */}
      <aside style={panelStyle}>
        <button
          type="button"
          onClick={() => setPanelOpen((o) => !o)}
          style={{
            height: 44,
            borderBottom: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text2)',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {panelOpen ? '◀' : '▶'}
        </button>
        {panelOpen && (
          <div
            style={{
              padding: '12px 14px 20px',
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              overflow: 'auto',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text2)', letterSpacing: 0.6 }}>
              SYSTEM INPUT
            </div>
            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Screen / window</label>
            <select
              disabled={lockDeviceInputs}
              value={settings.screenSourceId}
              onChange={(e) => patchSettings({ screenSourceId: e.target.value })}
              style={selectStyle}
            >
              {displaySources.length === 0 && <option value="">No sources</option>}
              {displaySources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={lockDeviceInputs}
              onClick={() => refreshDisplaySources()}
              style={smallBtn}
            >
              Refresh sources
            </button>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Microphone</label>
            <select
              disabled={lockDeviceInputs}
              value={settings.micId || ''}
              onChange={(e) => patchSettings({ micId: e.target.value })}
              style={selectStyle}
            >
              <option value="">Default</option>
              {audioInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Camera</label>
            <select
              disabled={lockDeviceInputs}
              value={settings.cameraId || ''}
              onChange={(e) => patchSettings({ cameraId: e.target.value })}
              style={selectStyle}
            >
              <option value="">Default</option>
              {videoInputs.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>

            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--text2)', letterSpacing: 0.6 }}>
              RECORDING
            </div>
            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Video quality</label>
            <select
              disabled={busy}
              value={settings.quality}
              onChange={(e) => patchSettings({ quality: e.target.value })}
              style={selectStyle}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Frame rate</label>
            <select
              disabled={busy}
              value={settings.frameRate}
              onChange={(e) => patchSettings({ frameRate: Number(e.target.value) })}
              style={selectStyle}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>Size / bandwidth mode</label>
            <select
              disabled={busy}
              value={settings.qualityMode}
              onChange={(e) => patchSettings({ qualityMode: e.target.value })}
              style={selectStyle}
            >
              <option value="low">Low — smaller files</option>
              <option value="balanced">Balanced</option>
              <option value="high">High — larger files</option>
            </select>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>After recording</label>
            <select
              disabled={busy}
              value={settings.defaultExport}
              onChange={(e) => patchSettings({ defaultExport: e.target.value })}
              style={selectStyle}
            >
              <option value="ask">Ask (WebM or MP4)</option>
              <option value="webm">Save WebM automatically</option>
              <option value="mp4">Convert to MP4 automatically</option>
            </select>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>MP4 encoder (background)</label>
            <select
              disabled={busy}
              value={settings.mp4Encoder || 'auto'}
              onChange={(e) => patchSettings({ mp4Encoder: e.target.value })}
              style={selectStyle}
            >
              <option value="auto">
                Auto
                {encoderCaps.nvenc || encoderCaps.qsv
                  ? ` (${encoderCaps.nvenc ? 'NVENC' : ''}${encoderCaps.nvenc && encoderCaps.qsv ? ' / ' : ''}${encoderCaps.qsv ? 'QSV' : ''} if available)`
                  : ' (CPU)'}
              </option>
              <option value="cpu">CPU (libx264 · veryfast)</option>
              <option value="nvenc" disabled={!encoderCaps.nvenc}>
                NVIDIA NVENC{!encoderCaps.nvenc ? ' — not detected' : ''}
              </option>
              <option value="qsv" disabled={!encoderCaps.qsv}>
                Intel Quick Sync{!encoderCaps.qsv ? ' — not detected' : ''}
              </option>
            </select>
            <p style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.45 }}>
              WebM is saved first; MP4 runs in the background (up to two at a time) without blocking the UI.
            </p>

            <label style={{ fontSize: 11, color: 'var(--text3)' }}>PiP position</label>
            <select
              disabled={busy}
              value={settings.pipPosition}
              onChange={(e) => {
                const v = e.target.value
                patchSettings({ pipPosition: v })
                applyPipPreset(v)
              }}
              style={selectStyle}
            >
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="top-right">Top right</option>
              <option value="top-left">Top left</option>
              <option value="center">Center</option>
            </select>
            <p style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.45 }}>
              Drag the webcam frame on the preview to reposition it while recording.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ToggleRow
                disabled={busy}
                label="Webcam overlay"
                checked={settings.webcam}
                onChange={(v) => patchSettings({ webcam: v })}
              />
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>Webcam frame shape</label>
              <select
                disabled={busy || !settings.webcam}
                value={settings.webcamShape || 'rectangle'}
                onChange={(e) => patchSettings({ webcamShape: e.target.value })}
                style={selectStyle}
              >
                <option value="rectangle">Rectangle (default)</option>
                <option value="circle">Round — full circle</option>
              </select>
              <label style={{ fontSize: 11, color: 'var(--text3)' }}>Webcam size</label>
              <select
                disabled={busy || !settings.webcam}
                value={settings.webcamSize || 'medium'}
                onChange={(e) => patchSettings({ webcamSize: e.target.value })}
                style={selectStyle}
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
              <ToggleRow
                disabled={busy}
                label="Microphone"
                checked={settings.mic}
                onChange={(v) => patchSettings({ mic: v })}
              />
              <ToggleRow
                disabled={busy}
                label="System audio"
                checked={settings.systemAudio}
                onChange={(v) => patchSettings({ systemAudio: v })}
              />
            </div>
          </div>
        )}
      </aside>

      {/* Main preview */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>
        <video
          ref={screenVideoRef}
          muted
          playsInline
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
        <video
          ref={camVideoRef}
          muted
          playsInline
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />

        <div
          ref={previewWrapRef}
          onPointerDown={onPipPointerDown}
          style={{
            flex: 1,
            background: '#000',
            position: 'relative',
            overflow: 'hidden',
            cursor: pipDragging
              ? 'grabbing'
              : settings.webcam && (isLive || isCountdown || (isIdle && previewActive))
                ? 'default'
                : 'default',
          }}
        >
          <div
            ref={canvasMountRef}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />

          {isIdle && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                paddingBottom: 108,
                gap: 12,
                pointerEvents: 'none',
                background:
                  'linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 38%, transparent 72%)',
              }}
            >
              {previewActive && (
                <span
                  style={{
                    position: 'absolute',
                    top: 14,
                    left: 14,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: 0.6,
                    color: 'rgba(255,255,255,.85)',
                    background: 'rgba(0,0,0,.45)',
                    padding: '6px 10px',
                    borderRadius: 8,
                    pointerEvents: 'none',
                  }}
                >
                  Preview — screen {settings.webcam ? '+ webcam' : ''}
                </span>
              )}
              <div
                style={{
                  pointerEvents: 'auto',
                  textAlign: 'center',
                  padding: '14px 20px 18px',
                  borderRadius: 16,
                  background: 'rgba(12,12,14,.55)',
                  border: '1px solid rgba(255,255,255,.08)',
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  maxWidth: 340,
                }}
              >
                <button
                  type="button"
                  onClick={startRecording}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: '50%',
                    background: 'var(--red)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    color: '#fff',
                    boxShadow: '0 0 0 12px rgba(239,68,68,.18)',
                  }}
                >
                  ●
                </button>
                <p style={{ color: 'var(--text2)', fontSize: 14, marginTop: 14 }}>Start recording</p>
                <p style={{ color: 'var(--text3)', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
                  Rough estimate: ~{est10MinMB} MB per 10 min (WebM, varies with content).
                </p>
              </div>
            </div>
          )}

          {isCountdown && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,.55)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                pointerEvents: 'none',
              }}
            >
              <div
                key={countdown}
                style={{
                  fontSize: 120,
                  fontWeight: 800,
                  color: '#fff',
                  lineHeight: 1,
                  animation: 'countdown-pop .9s ease forwards',
                }}
              >
                {countdown}
              </div>
              <span style={{ color: 'rgba(255,255,255,.7)', fontSize: 16, letterSpacing: 2 }}>GET READY</span>
            </div>
          )}

          {isSaving && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,.72)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                padding: 24,
              }}
            >
              <div
                style={{
                  width: 'min(320px, 100%)',
                  height: 10,
                  borderRadius: 999,
                  background: 'var(--bg4)',
                  overflow: 'hidden',
                  border: '1px solid var(--border2)',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${savePct}%`,
                    borderRadius: 999,
                    background: 'linear-gradient(90deg, var(--purple), var(--green))',
                    transition: 'width .12s ease-out',
                  }}
                />
              </div>
              <span
                style={{
                  color: '#fff',
                  fontSize: 28,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                  letterSpacing: 0.5,
                }}
              >
                {Math.round(savePct)}%
              </span>
              <span style={{ color: 'var(--text2)', fontSize: 14, textAlign: 'center', maxWidth: 380, lineHeight: 1.4 }}>
                {saveLabel}
              </span>
            </div>
          )}

          {isExportChoice && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                padding: 24,
                zIndex: 8,
              }}
            >
              <span style={{ color: '#fff', fontWeight: 700, fontSize: 17 }}>Save recording</span>
              <p style={{ color: 'var(--text2)', fontSize: 13, textAlign: 'center', maxWidth: 420 }}>
                WebM is smaller. MP4 works everywhere. You can compress later from the library.
              </p>
              <p style={{ color: 'var(--purple)', fontSize: 13 }}>
                Captured: {formatSizeBytes(writtenBytes)} raw WebM
              </p>
              {exportHint && (
                <p style={{ color: 'var(--amber)', fontSize: 12, maxWidth: 400, textAlign: 'center' }}>{exportHint}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 320 }}>
                <button
                  type="button"
                  onClick={() => finalizeExport('webm')}
                  style={{ ...primaryBtn, width: '100%', background: 'var(--green)', border: 'none' }}
                >
                  Save as WebM (recommended · smaller)
                </button>
                <button type="button" onClick={() => finalizeExport('mp4')} style={{ ...primaryBtn, width: '100%' }}>
                  Save WebM + MP4 in background
                </button>
                <button
                  type="button"
                  onClick={() => finalizeExport('compress-webm')}
                  style={{ ...secondaryBtn, width: '100%' }}
                >
                  Compress WebM (smaller, slower)
                </button>
                <button type="button" onClick={discardRecording} style={{ ...secondaryBtn, width: '100%', color: 'var(--red)' }}>
                  Discard
                </button>
              </div>
            </div>
          )}

          {isDone && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,.88)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                padding: 24,
                animation: 'fade-in .3s ease',
              }}
            >
              <div style={{ fontSize: 52 }}>✓</div>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>Recording saved</span>
              {lastFileSize > 0 && (
                <span style={{ color: 'var(--purple)', fontSize: 14 }}>Size: {formatSizeBytes(lastFileSize)}</span>
              )}
              <span
                style={{
                  color: 'var(--text2)',
                  fontSize: 12,
                  maxWidth: 520,
                  textAlign: 'center',
                  wordBreak: 'break-all',
                  lineHeight: 1.5,
                }}
              >
                {lastFile}
              </span>
              {exportHint && (
                <p style={{ color: 'var(--amber)', fontSize: 12, maxWidth: 440, textAlign: 'center' }}>{exportHint}</p>
              )}

              {mp4Job && ['queued', 'running'].includes(mp4Job.status) && (
                <div
                  style={{
                    width: '100%',
                    maxWidth: 400,
                    padding: 14,
                    borderRadius: 12,
                    background: 'rgba(99,102,241,.12)',
                    border: '1px solid rgba(99,102,241,.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>MP4 (background)</span>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 99,
                      background: 'var(--bg4)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(0, mp4Job.percent || 0))}%`,
                        background: 'linear-gradient(90deg, var(--purple), var(--green))',
                        transition: 'width .12s ease-out',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--text2)', fontSize: 12 }}>
                      {Math.round(mp4Job.percent || 0)}% — {mp4Job.label || 'Optimizing…'}
                    </span>
                    <button
                      type="button"
                      onClick={() => window.electronAPI?.cancelMp4Conversion?.(mp4Job.id)}
                      style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {mp4Job && mp4Job.status === 'failed' && (
                <div
                  style={{
                    width: '100%',
                    maxWidth: 400,
                    padding: 12,
                    borderRadius: 12,
                    background: 'rgba(239,68,68,.1)',
                    border: '1px solid var(--red)',
                    fontSize: 12,
                    color: 'var(--red)',
                    textAlign: 'center',
                  }}
                >
                  <p style={{ margin: '0 0 8px' }}>{mp4Job.error || 'MP4 conversion failed. WebM is safe on disk.'}</p>
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.retryMp4Conversion?.(mp4Job.id)}
                    style={{ ...primaryBtn, padding: '8px 16px', fontSize: 13 }}
                  >
                    Retry MP4
                  </button>
                </div>
              )}

              {mp4Job && mp4Job.status === 'completed' && mp4Job.mp4Path && (
                <p style={{ color: 'var(--green)', fontSize: 13, textAlign: 'center', maxWidth: 480 }}>
                  MP4 ready —{' '}
                  <button
                    type="button"
                    onClick={() => window.electronAPI?.openFile?.(mp4Job.mp4Path)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--green)',
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 13,
                    }}
                  >
                    Open MP4
                  </button>
                </p>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => lastFile && window.electronAPI?.openFile?.(lastFile)}
                  style={primaryBtn}
                >
                  Open WebM
                </button>
                <button
                  type="button"
                  onClick={() => lastFile && window.electronAPI?.showItemInFolder?.(lastFile)}
                  style={secondaryBtn}
                >
                  Open folder
                </button>
                <button
                  type="button"
                  onClick={() => {
                    reset()
                    onBack()
                  }}
                  style={secondaryBtn}
                >
                  Back to home
                </button>
              </div>
            </div>
          )}

          {previewError && isIdle && !error && (
            <div
              style={{
                position: 'absolute',
                bottom: 96,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(245,158,11,.12)',
                border: '1px solid var(--amber)',
                borderRadius: 8,
                padding: '10px 18px',
                color: 'var(--amber)',
                fontSize: 13,
                maxWidth: 480,
                textAlign: 'center',
              }}
            >
              {previewError}
            </div>
          )}

          {error && (
            <div
              style={{
                position: 'absolute',
                bottom: 96,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(239,68,68,.12)',
                border: '1px solid var(--red)',
                borderRadius: 8,
                padding: '10px 18px',
                color: 'var(--red)',
                fontSize: 13,
                maxWidth: 480,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Floating toolbar */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 20,
            transform: `translate(calc(-50% + ${toolbarOffset.x}px), ${toolbarOffset.y}px)`,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: '96vw',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 999,
            background: 'rgba(22,22,25,.92)',
            border: '1px solid var(--border2)',
            boxShadow: '0 12px 40px rgba(0,0,0,.45)',
            WebkitBackdropFilter: 'blur(12px)',
            zIndex: 5,
          }}
        >
          <button
            type="button"
            title="Drag toolbar"
            onPointerDown={(e) => {
              e.preventDefault()
              toolbarDragRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                startOffsetX: toolbarOffset.x,
                startOffsetY: toolbarOffset.y,
              }
              setToolbarDragging(true)
            }}
            style={{ ...iconBtn, cursor: toolbarDragging ? 'grabbing' : 'grab' }}
          >
            ⠿
          </button>
          <button
            type="button"
            title="Reset toolbar position"
            onClick={() => setToolbarOffset({ x: 0, y: 0 })}
            style={iconBtn}
          >
            ⌖
          </button>
          <button
            type="button"
            onClick={() => {
              reset()
              onBack()
            }}
            title="Back"
            style={iconBtn}
          >
            ←
          </button>
          <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

          {isIdle && (
            <button type="button" onClick={startRecording} style={recBtn}>
              <span style={{ fontSize: 9 }}>●</span> Start
            </button>
          )}

          {isCountdown && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--amber)', fontWeight: 700 }}>
              <span style={{ animation: 'blink .6s ease infinite' }}>●</span>
              {countdown}
            </div>
          )}

          {isLive && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--red)',
                    animation: 'blink .9s ease-in-out infinite',
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--red)' }}>REC</span>
              </div>
              <span
                style={{
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 14,
                  fontWeight: 600,
                  minWidth: 72,
                }}
              >
                {fmtHMS(duration)}
              </span>
              {recordingSizeToolbar}
            </>
          )}

          {state === STATES.PAUSED && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--amber)' }} />
                <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--amber)' }}>PAUSED</span>
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 14, fontWeight: 600, minWidth: 72 }}>
                {fmtHMS(duration)}
              </span>
              {recordingSizeToolbar}
            </>
          )}

          <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

          {(isLive || state === STATES.PAUSED) && settings.mic && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                <rect x="7" y="1" width="6" height="11" rx="3" stroke="var(--text2)" strokeWidth="1.5"/>
                <path d="M4 9a6 6 0 0012 0" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round"/>
                <line x1="10" y1="15" x2="10" y2="19" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <MicBars level={micLevel} />
            </div>
          )}

          {isLive && (
            <>
              <button type="button" onClick={togglePause} title="Pause" style={roundIconBtn}>
                ⏸
              </button>
              <button type="button" onClick={stopRecording} title="Stop" style={roundStopBtn}>
                ⏹
              </button>
            </>
          )}

          {state === STATES.PAUSED && (
            <>
              <button type="button" onClick={togglePause} title="Resume" style={roundResumeBtn}>
                ▶
              </button>
              <button type="button" onClick={stopRecording} title="Stop" style={roundStopBtn}>
                ⏹
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, disabled }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        fontSize: 13,
        color: 'var(--text)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        style={{
          width: 44,
          height: 24,
          borderRadius: 12,
          border: 'none',
          background: checked ? 'var(--purple)' : 'var(--bg4)',
          position: 'relative',
          transition: 'background .15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: checked ? 22 : 4,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
          }}
        />
      </button>
    </label>
  )
}

const selectStyle = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  fontSize: 12,
}

const smallBtn = {
  padding: '6px 10px',
  borderRadius: 8,
  background: 'var(--bg4)',
  border: '1px solid var(--border2)',
  color: 'var(--text2)',
  fontSize: 11,
}

const iconBtn = {
  background: 'none',
  color: 'var(--text2)',
  fontSize: 18,
  padding: '4px 6px',
  borderRadius: 6,
}

const recBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--red)',
  color: '#fff',
  padding: '8px 16px',
  borderRadius: 999,
  fontWeight: 700,
  fontSize: 13,
}

const roundIconBtn = {
  width: 36,
  height: 36,
  borderRadius: 10,
  background: 'var(--bg4)',
  border: '1px solid var(--border2)',
  color: 'var(--text)',
  fontSize: 15,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const roundStopBtn = {
  ...roundIconBtn,
  background: 'rgba(239,68,68,.15)',
  borderColor: 'rgba(239,68,68,.4)',
  color: 'var(--red)',
}

const roundResumeBtn = {
  ...roundIconBtn,
  background: 'rgba(34,197,94,.12)',
  borderColor: 'rgba(34,197,94,.4)',
  color: 'var(--green)',
}

const primaryBtn = {
  padding: '10px 20px',
  borderRadius: 10,
  background: 'var(--purple)',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
}

const secondaryBtn = {
  padding: '10px 20px',
  borderRadius: 10,
  background: 'var(--bg4)',
  border: '1px solid var(--border2)',
  color: 'var(--text)',
  fontWeight: 500,
  fontSize: 14,
}
