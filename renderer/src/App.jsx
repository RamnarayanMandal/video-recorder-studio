import { useState, useEffect } from 'react'
import { HomePage } from './pages/HomePage.jsx'
import { RecorderPage } from './pages/RecorderPage.jsx'
import { BackgroundConversionBar } from './components/BackgroundConversionBar.jsx'
import { useConversionJobsStore } from './stores/conversionJobsStore.js'
import { STORAGE_KEYS, loadString, saveString } from './lib/recordingSettings.js'
import appLogo from './assets/logo-icon.png'

export default function App() {
  const [page, setPage] = useState('home')
  const [saveFolder, setSaveFolder] = useState(() => loadString(STORAGE_KEYS.saveFolder, ''))
  const [refreshKey, setRefreshKey] = useState(0)

  const pickFolder = async () => {
    const folder = await window.electronAPI?.pickSaveFolder?.()
    if (folder) {
      setSaveFolder(folder)
      saveString(STORAGE_KEYS.saveFolder, folder)
    }
  }

  const goRecorder = () => {
    setPage('recorder')
  }

  const goHome = () => {
    setPage('home')
  }

  const isMac = window.electronAPI?.platform === 'darwin'

  useEffect(() => {
    const subscribe = window.electronAPI?.onConversionJobUpdate
    if (typeof subscribe !== 'function') return undefined
    const unsub = subscribe((payload) => {
      const job = payload?.job
      if (!job?.id) return
      const prev = useConversionJobsStore.getState().jobsById[job.id]
      useConversionJobsStore.getState().upsertJob(job)
      if (job.status === 'completed' && job.mp4Path && prev?.status !== 'completed') {
        setRefreshKey((k) => k + 1)
        try {
          const name = String(job.mp4Path).split(/[/\\]/).pop()
          new Notification('MP4 ready', { body: name || 'Conversion finished.' })
        } catch {
          /* Notification API unavailable */
        }
      }
    })
    return () => unsub?.()
  }, [])

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
    }}>
      <div style={{
        height: 48, flexShrink: 0,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        paddingLeft: isMac ? 80 : 16,
        paddingRight: 16,
        gap: 12,
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}>
        <img
          src={appLogo}
          alt="Video Recorder Studio logo"
          style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 4 }}
        />
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: .2 }}>Video Recorder Studio</span>

        <div style={{ flex: 1 }} />

        {['home', 'recorder'].map(p => (
          <button
            key={p}
            onClick={() => p === 'recorder' ? goRecorder() : goHome()}
            style={{
              WebkitAppRegion: 'no-drag',
              padding: '4px 14px', borderRadius: 16,
              background: page === p ? 'var(--bg4)' : 'none',
              border: '1px solid ' + (page === p ? 'var(--border2)' : 'transparent'),
              color: page === p ? 'var(--text)' : 'var(--text2)',
              fontSize: 13, fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {p === 'recorder' ? '● Recorder' : 'Home'}
          </button>
        ))}

        <div
          onClick={pickFolder}
          title={saveFolder || 'Click to set save folder'}
          style={{
            WebkitAppRegion: 'no-drag',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 16,
            border: '1px solid var(--border)',
            cursor: 'pointer', color: 'var(--text2)', fontSize: 12,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
            <path d="M2 5a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"
              stroke="currentColor" strokeWidth="1.5" fill="none"/>
          </svg>
          {saveFolder
            ? saveFolder.split(/[/\\]/).pop()
            : 'Set folder'}
        </div>
      </div>

      <BackgroundConversionBar />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {page === 'home' ? (
          <HomePage
            key={refreshKey}
            saveFolder={saveFolder}
            onPickFolder={pickFolder}
            onStartRecorder={goRecorder}
          />
        ) : (
          <RecorderPage
            saveFolder={saveFolder}
            onBack={goHome}
            onSaved={() => setRefreshKey(k => k + 1)}
          />
        )}
      </div>
    </div>
  )
}
