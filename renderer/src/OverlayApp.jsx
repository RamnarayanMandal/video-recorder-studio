import { useEffect, useMemo, useRef, useState } from 'react'
import { getDesktopMediaStream } from './lib/desktopCapture.js'
import { CanvasComposer } from './lib/canvasComposer.js'

const DEFAULT_CONFIG = {
  active: false,
  screenSourceId: '',
  cameraId: '',
  webcam: true,
  webcamShape: 'rectangle',
  webcamSize: 'medium',
  durationSec: 0,
  micLevel: 0,
  isPaused: false,
  micEnabled: true,
}

function fmtHMS(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return [h, m, ss].map((n) => String(n).padStart(2, '0')).join(':')
}

export function OverlayApp() {
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [resizing, setResizing] = useState(false)
  const [status, setStatus] = useState('Recording...')
  const [domReady, setDomReady] = useState(document.readyState !== 'loading')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [micBars, setMicBars] = useState([0, 0, 0, 0, 0, 0])
  const resizeRef = useRef(null)
  const mountRef = useRef(null)
  const screenVideoRef = useRef(null)
  const camVideoRef = useRef(null)
  const composerRef = useRef(null)
  const streamsRef = useRef({ screen: null, cam: null, mic: null })
  const audioCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const micAnimRef = useRef(0)

  useEffect(() => {
    if (document.readyState !== 'loading') {
      setDomReady(true)
      return undefined
    }
    const onReady = () => {
      setDomReady(true)
      console.log('Overlay loaded')
    }
    document.addEventListener('DOMContentLoaded', onReady, { once: true })
    return () => document.removeEventListener('DOMContentLoaded', onReady)
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI?.onOverlayConfig?.((next) => {
      setConfig((prev) => ({ ...prev, ...(next || {}) }))
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    if (!domReady) return undefined
    let cancelled = false
    async function startPreview() {
      stopPreview()
      if (!config.active || !config.screenSourceId) {
        setStatus('Waiting for recording...')
        return
      }
      try {
        console.log('Starting preview...')
        const screen = await getDesktopMediaStream(config.screenSourceId, {
          width: 1280,
          height: 720,
          frameRate: 30,
          withSystemAudio: false,
        })
        console.log('Screen stream:', screen)
        let cam = null
        if (config.webcam) {
          cam = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: config.cameraId ? { exact: config.cameraId } : undefined,
              width: { ideal: 640 },
              height: { ideal: 480 },
              ...(!config.cameraId ? { facingMode: 'user' } : {}),
            },
            audio: false,
          })
        }
        let mic = null
        try {
          mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        } catch {
          mic = null
        }
        if (cancelled) {
          screen.getTracks().forEach((t) => t.stop())
          cam?.getTracks().forEach((t) => t.stop())
          mic?.getTracks().forEach((t) => t.stop())
          return
        }
        streamsRef.current = { screen, cam, mic }
        const sv = screenVideoRef.current
        const cv = camVideoRef.current
        if (sv) {
          sv.srcObject = screen
          await sv.play().catch(() => {})
        }
        if (cv) {
          cv.srcObject = cam
          await cv.play().catch(() => {})
        }
        const composer = new CanvasComposer({ width: 1280, height: 720, frameRate: 30 })
        composer.setVideos(sv, cv)
        composer.setWebcamEnabled(config.webcam)
        composer.setPipShape(config.webcamShape || 'rectangle')
        composer.setPipSize(config.webcamSize || 'medium')
        composer.start()
        composerRef.current = composer
        if (mountRef.current) {
          mountRef.current.innerHTML = ''
          const canvas = composer.getCanvas()
          if (canvas) {
            canvas.style.width = '100%'
            canvas.style.height = '100%'
            canvas.style.objectFit = 'cover'
            mountRef.current.appendChild(canvas)
          }
        }
        if (mic) startMicMeter(mic)
        setStatus('Live preview')
      } catch (e) {
        console.error('Overlay preview failed:', e)
        setStatus(e?.message || 'Preview failed')
      }
    }
    startPreview()
    return () => {
      cancelled = true
      stopPreview()
    }
  }, [domReady, config.active, config.screenSourceId, config.cameraId, config.webcam, config.webcamShape, config.webcamSize])

  useEffect(() => {
    if (!resizing) return
    const onMove = (e) => {
      if (!resizeRef.current) return
      const dw = e.clientX - resizeRef.current.x
      const dh = e.clientY - resizeRef.current.y
      resizeRef.current = { x: e.clientX, y: e.clientY }
      window.electronAPI.overlayResizeBy({ dw, dh })
    }
    const onUp = () => {
      setResizing(false)
      resizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [resizing])

  useEffect(() => {
    setElapsedSec(config.durationSec || 0)
  }, [config.durationSec])

  useEffect(() => {
    if (!config.active || config.isPaused) return
    const id = setInterval(() => {
      setElapsedSec((s) => s + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [config.active, config.isPaused])

  function startMicMeter(micStream) {
    try {
      cancelAnimationFrame(micAnimRef.current)
      audioCtxRef.current?.close?.().catch(() => {})
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(micStream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      const buf = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(buf)
        const seg = Math.max(1, Math.floor(buf.length / 6))
        const bars = Array.from({ length: 6 }).map((_, i) => {
          let sum = 0
          for (let j = i * seg; j < Math.min(buf.length, (i + 1) * seg); j++) sum += buf[j]
          return Math.min(1, (sum / seg) / 255)
        })
        setMicBars(bars)
        micAnimRef.current = requestAnimationFrame(tick)
      }
      tick()
    } catch {
      setMicBars([0, 0, 0, 0, 0, 0])
    }
  }

  function stopPreview() {
    cancelAnimationFrame(micAnimRef.current)
    analyserRef.current = null
    audioCtxRef.current?.close?.().catch(() => {})
    audioCtxRef.current = null
    composerRef.current?.stop?.()
    composerRef.current = null
    if (mountRef.current) mountRef.current.innerHTML = ''
    const { screen, cam, mic } = streamsRef.current
    screen?.getTracks().forEach((t) => t.stop())
    cam?.getTracks().forEach((t) => t.stop())
    mic?.getTracks().forEach((t) => t.stop())
    streamsRef.current = { screen: null, cam: null, mic: null }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null
    if (camVideoRef.current) camVideoRef.current.srcObject = null
    setMicBars([0, 0, 0, 0, 0, 0])
  }

  const meterBars = useMemo(
    () =>
      micBars.map((val, i) => (
        <span
          key={i}
          style={{
            width: 3,
            borderRadius: 2,
            height: 5 + Math.round(val * 16),
            background: val > 0.75 ? '#f87171' : val > 0.45 ? '#fbbf24' : '#34d399',
            transition: 'height .08s linear',
          }}
        />
      )),
    [micBars],
  )

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        borderRadius: 14,
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,.28)',
        background: 'rgba(6,6,8,.45)',
        boxShadow: '0 12px 40px rgba(0,0,0,.5)',
        position: 'relative',
        userSelect: 'none',
        animation: 'fade-in .22s ease',
        WebkitAppRegion: 'drag',
      }}
    >
      <video ref={screenVideoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
      <video ref={camVideoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={recordingPill}>
        <span style={{ color: config.isPaused ? '#f59e0b' : '#ef4444', animation: config.isPaused ? 'none' : 'blink .8s ease infinite' }}>
          ●
        </span>{' '}
        {config.isPaused ? 'Paused' : 'Recording...'}
      </div>
      <div style={controlBar}>
        <span style={{ color: '#fff', fontSize: 12, minWidth: 72, fontVariantNumeric: 'tabular-nums' }}>
          {fmtHMS(elapsedSec)}
        </span>
        <button
          type="button"
          onClick={() => window.electronAPI.overlayToggleMic()}
          style={controlBtn}
          title={config.micEnabled ? 'Mute mic' : 'Unmute mic'}
        >
          {config.micEnabled ? '🎤' : '🔇'}
        </button>
        <button
          type="button"
          onClick={() => window.electronAPI.overlayTogglePause()}
          style={controlBtn}
          title={config.isPaused ? 'Resume' : 'Pause'}
        >
          {config.isPaused ? '▶' : '⏸'}
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22, width: 26 }}>
          {meterBars}
        </div>
        <button
          type="button"
          onClick={() => window.electronAPI.overlayStopRecording()}
          style={{ ...controlBtn, color: '#f87171' }}
          title="Stop recording"
        >
          ⏹
        </button>
        <button type="button" onClick={() => window.electronAPI.overlayCenter()} style={controlBtn} title="Center overlay">
          ⌖
        </button>
        <span style={dragIndicator} title="Drag overlay">⠿</span>
      </div>
      <div
        onPointerDown={(e) => {
          e.preventDefault()
          resizeRef.current = { x: e.clientX, y: e.clientY }
          setResizing(true)
        }}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 24,
          height: 24,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 45%, rgba(255,255,255,.55) 45%, rgba(255,255,255,.55) 55%, transparent 55%)',
          zIndex: 5,
          WebkitAppRegion: 'no-drag',
        }}
      />
    </div>
  )
}

const controlBtn = {
  width: 30,
  height: 30,
  borderRadius: 999,
  background: 'rgba(0,0,0,.48)',
  border: '1px solid rgba(255,255,255,.3)',
  color: '#fff',
  fontSize: 14,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  WebkitAppRegion: 'no-drag',
  cursor: 'pointer',
}

const controlBar = {
  position: 'absolute',
  left: '50%',
  bottom: 12,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,.25)',
  background: 'rgba(16,16,20,.52)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  zIndex: 6,
  WebkitAppRegion: 'no-drag',
}

const dragIndicator = {
  fontSize: 15,
  color: 'rgba(255,255,255,.85)',
  padding: '4px 6px',
  cursor: 'move',
}

const recordingPill = {
  position: 'absolute',
  top: 10,
  left: 10,
  fontSize: 11,
  color: '#fff',
  background: 'rgba(0,0,0,.42)',
  border: '1px solid rgba(255,255,255,.2)',
  borderRadius: 999,
  padding: '5px 10px',
  zIndex: 6,
  WebkitAppRegion: 'no-drag',
}
