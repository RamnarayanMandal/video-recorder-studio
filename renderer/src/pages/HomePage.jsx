import { useState, useEffect, useMemo, useCallback } from 'react'
import { STORAGE_KEYS, loadString, saveString } from '../lib/recordingSettings.js'

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function fmtDur(sec) {
  if (sec == null || Number.isNaN(sec)) return '—'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  return `${m}:${String(ss).padStart(2, '0')}`
}

function timeAgo(ms) {
  const d = Date.now() - ms
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`
  return `${Math.floor(d / 86400000)}d ago`
}

const TAG_OPTIONS = ['', 'Lecture', 'Meeting', 'Tutorial', 'Gameplay', 'Other']

export function HomePage({ saveFolder, onPickFolder, onStartRecorder }) {
  const [storageStats, setStorageStats] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [sortBy, setSortBy] = useState('date-desc')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState({})
  const [autoCleanupDays, setAutoCleanupDays] = useState(() => {
    const v = loadString(STORAGE_KEYS.autoCleanupDays)
    return v ? Number(v) : ''
  })

  const loadAll = useCallback(async () => {
    if (!saveFolder) {
      setItems([])
      setStorageStats(null)
      return
    }
    setLoading(true)
    try {
      const [stats, list] = await Promise.all([
        window.electronAPI.getStorageStats(saveFolder),
        window.electronAPI.listRecordingsDetailed(saveFolder, { withThumbnails: true, limit: 100 }),
      ])
      setStorageStats(stats)
      setItems(list)
      const meta = await window.electronAPI.libraryMetaGet(saveFolder)
      if (meta.autoCleanupDays && !loadString(STORAGE_KEYS.autoCleanupDays)) {
        setAutoCleanupDays(meta.autoCleanupDays)
      }
    } finally {
      setLoading(false)
    }
  }, [saveFolder])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const filteredSorted = useMemo(() => {
    let rows = items.filter((it) => {
      const q = search.trim().toLowerCase()
      if (!q) return true
      return (
        it.name.toLowerCase().includes(q) ||
        (it.tag && it.tag.toLowerCase().includes(q))
      )
    })
    if (sortBy === 'date-desc') rows.sort((a, b) => b.mtime - a.mtime)
    if (sortBy === 'date-asc') rows.sort((a, b) => a.mtime - b.mtime)
    if (sortBy === 'size-desc') rows.sort((a, b) => b.size - a.size)
    if (sortBy === 'size-asc') rows.sort((a, b) => a.size - b.size)
    return rows
  }, [items, search, sortBy])

  const duplicateGroups = useMemo(() => {
    const map = new Map()
    for (const it of items) {
      if (it.durationSec == null) continue
      const key = `${it.size}:${Math.round(it.durationSec)}`
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(it)
    }
    return [...map.values()].filter((g) => g.length > 1)
  }, [items])

  const largeOld = useMemo(() => {
    const large = [...items].sort((a, b) => b.size - a.size).slice(0, 3)
    const old = [...items].sort((a, b) => a.mtime - b.mtime).slice(0, 3)
    return { large, old }
  }, [items])

  const toggleSel = (fp) => {
    setSelected((s) => ({ ...s, [fp]: !s[fp] }))
  }

  const bulkDelete = async () => {
    const paths = Object.keys(selected).filter((k) => selected[k])
    if (!paths.length) return
    await window.electronAPI.deleteFiles(paths)
    setSelected({})
    loadAll()
  }

  const setTag = async (filename, tag) => {
    if (!saveFolder) return
    await window.electronAPI.librarySetTag({ folder: saveFolder, filename, tag })
    loadAll()
  }

  const compressOne = async (filepath) => {
    const r = await window.electronAPI.compressVideoFile({ filepath, quality: 'balanced' })
    if (r.success) loadAll()
    else alert(r.error || 'Compress failed')
  }

  const drivePct = storageStats?.driveUsedPercent ?? 0
  const freeStr = storageStats ? formatSize(storageStats.driveFreeBytes) : '—'
  const usedStr = storageStats ? formatSize(storageStats.driveTotalBytes - storageStats.driveFreeBytes) : '—'
  const totalStr = storageStats ? formatSize(storageStats.driveTotalBytes) : '—'
  const folderStr = storageStats ? formatSize(storageStats.folderBytes) : '—'

  return (
    <div
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '28px 28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        animation: 'fade-in .3s ease',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <button
          type="button"
          onClick={onStartRecorder}
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #9b5cf6 60%, #a78bfa 100%)',
            border: 'none',
            borderRadius: 16,
            padding: '36px 28px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            cursor: 'pointer',
          }}
        >
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 18 }}>Video Recorder</span>
          <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 12 }}>Storage-aware capture · WebM or MP4</span>
        </button>
        <div
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '18px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text2)' }}>Drive storage</div>
          {saveFolder && storageStats ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--text)' }}>
                Used: {usedStr} / {totalStr}{' '}
                <span style={{ color: 'var(--text3)' }}>({drivePct}%)</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>Free: {freeStr}</div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg4)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${Math.min(100, drivePct)}%`,
                    height: '100%',
                    background:
                      drivePct >= 90 ? 'var(--red)' : drivePct >= 80 ? 'var(--amber)' : 'var(--green)',
                    transition: 'width .3s',
                  }}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                Videos in folder: <strong style={{ color: 'var(--text)' }}>{folderStr}</strong>
              </div>
              {storageStats.warnings?.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--amber)' }}>
                  {storageStats.warnings.map((w) => w.message).join(' · ')}
                </div>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Select a folder to see usage.</span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '10px 14px',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 13, flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {saveFolder || 'No folder'}
        </span>
        <button
          type="button"
          onClick={onPickFolder}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            background: 'var(--bg4)',
            border: '1px solid var(--border2)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        >
          Change folder
        </button>
        {saveFolder && (
          <button
            type="button"
            onClick={() => window.electronAPI.openFolder(saveFolder)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
              fontSize: 12,
            }}
          >
            Open folder
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: 'var(--text3)' }}>
          Auto-delete older than{' '}
          <input
            type="number"
            min={0}
            placeholder="days"
            value={autoCleanupDays}
            onChange={(e) => {
              const v = e.target.value === '' ? '' : Number(e.target.value)
              setAutoCleanupDays(v)
              if (v === '' || v === 0) saveString(STORAGE_KEYS.autoCleanupDays, '')
              else saveString(STORAGE_KEYS.autoCleanupDays, String(v))
            }}
            style={{
              width: 56,
              marginLeft: 6,
              padding: 4,
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg3)',
              color: 'var(--text)',
            }}
          />{' '}
          days
        </label>
        <button
          type="button"
          onClick={async () => {
            if (!saveFolder || !autoCleanupDays) return
            await window.electronAPI.libraryMetaSet({
              folder: saveFolder,
              meta: { ...(await window.electronAPI.libraryMetaGet(saveFolder)), autoCleanupDays },
            })
            await window.electronAPI.libraryAutoCleanup({ folder: saveFolder, maxAgeDays: autoCleanupDays })
            loadAll()
          }}
          style={{
            padding: '6px 12px',
            fontSize: 11,
            borderRadius: 6,
            background: 'var(--bg4)',
            border: '1px solid var(--border2)',
            color: 'var(--text)',
          }}
        >
          Run cleanup
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search name or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 160,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg3)',
            color: 'var(--text)',
            fontSize: 13,
          }}
        />
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--bg3)',
            color: 'var(--text)',
            fontSize: 12,
          }}
        >
          <option value="date-desc">Newest first</option>
          <option value="date-asc">Oldest first</option>
          <option value="size-desc">Largest first</option>
          <option value="size-asc">Smallest first</option>
        </select>
        <button
          type="button"
          onClick={loadAll}
          style={{ background: 'none', border: 'none', color: 'var(--text2)', fontSize: 12 }}
        >
          ↺ Refresh
        </button>
        <button
          type="button"
          onClick={bulkDelete}
          disabled={!Object.values(selected).some(Boolean)}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            background: Object.values(selected).some(Boolean) ? 'rgba(239,68,68,.15)' : 'var(--bg4)',
            border: '1px solid var(--border)',
            color: 'var(--red)',
            fontSize: 12,
            opacity: Object.values(selected).some(Boolean) ? 1 : 0.4,
          }}
        >
          Delete selected
        </button>
      </div>

      {(duplicateGroups.length > 0 || largeOld.large.length > 0) && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--text2)',
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '12px 14px',
            lineHeight: 1.6,
          }}
        >
          {duplicateGroups.length > 0 && (
            <div>
              <strong style={{ color: 'var(--amber)' }}>Possible duplicates</strong> (same size &amp; length):{' '}
              {duplicateGroups.length} group(s)
            </div>
          )}
          {largeOld.large[0] && (
            <div style={{ marginTop: 6 }}>
              <strong>Largest file:</strong> {largeOld.large[0].name} ({formatSize(largeOld.large[0].size)})
            </div>
          )}
        </div>
      )}

      <div style={{ fontWeight: 600, fontSize: 15 }}>
        Library {loading ? '(loading…)' : `(${filteredSorted.length})`}
      </div>

      {filteredSorted.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13, padding: '24px 0' }}>
          {!saveFolder ? 'Choose a recordings folder.' : 'No videos match.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 14,
          }}
        >
          {filteredSorted.map((r) => (
            <div
              key={r.filepath}
              style={{
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  aspectRatio: '16/9',
                  background: 'var(--bg3)',
                  position: 'relative',
                }}
              >
                {r.thumbnailDataUrl ? (
                  <img
                    src={r.thumbnailDataUrl}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>No preview</span>
                  </div>
                )}
                <label
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    background: 'rgba(0,0,0,.55)',
                    borderRadius: 4,
                    padding: 2,
                  }}
                >
                  <input type="checkbox" checked={!!selected[r.filepath]} onChange={() => toggleSel(r.filepath)} />
                </label>
              </div>
              <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{fmtDur(r.durationSec)}</span>
                  <span>{formatSize(r.size)}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{timeAgo(r.mtime)}</div>
                <select
                  value={r.tag || ''}
                  onChange={(e) => setTag(r.name, e.target.value)}
                  style={{
                    padding: '4px 6px',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--bg3)',
                    color: 'var(--text)',
                  }}
                >
                  {TAG_OPTIONS.map((t) => (
                    <option key={t === '' ? '_none' : t} value={t}>
                      {t ? `Tag: ${t}` : 'Tag…'}
                    </option>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => window.electronAPI.openFile(r.filepath)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 11,
                      borderRadius: 6,
                      background: 'var(--purple)',
                      border: 'none',
                      color: '#fff',
                    }}
                  >
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={() => compressOne(r.filepath)}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 11,
                      borderRadius: 6,
                      background: 'var(--bg4)',
                      border: '1px solid var(--border2)',
                      color: 'var(--text)',
                    }}
                  >
                    Compress
                  </button>
                  <button
                    type="button"
                    onClick={() => window.electronAPI.showItemInFolder(r.filepath)}
                    style={{
                      padding: '6px 8px',
                      fontSize: 11,
                      borderRadius: 6,
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--text2)',
                    }}
                  >
                    Folder
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
