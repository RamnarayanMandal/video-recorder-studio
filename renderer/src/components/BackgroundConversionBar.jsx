import { useShallow } from 'zustand/react/shallow'
import { useConversionJobsStore } from '../stores/conversionJobsStore.js'

export function BackgroundConversionBar() {
  const jobs = useConversionJobsStore(
    useShallow((s) =>
      Object.values(s.jobsById).filter((j) => j && ['queued', 'running', 'failed'].includes(j.status)),
    ),
  )

  if (!jobs.length) return null

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg2)',
        padding: '8px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 120,
        overflowY: 'auto',
      }}
    >
      {jobs.map((job) => (
        <div
          key={job.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 12,
            color: 'var(--text2)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: 120 }}>
            MP4 conversion
          </span>
          {job.status === 'running' || job.status === 'queued' ? (
            <>
              <div
                style={{
                  flex: 1,
                  minWidth: 120,
                  maxWidth: 280,
                  height: 6,
                  borderRadius: 99,
                  background: 'var(--bg4)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, job.percent || 0))}%`,
                    background: 'linear-gradient(90deg, var(--purple), var(--green))',
                    transition: 'width .15s ease-out',
                  }}
                />
              </div>
              <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 40 }}>
                {Math.round(job.percent || 0)}%
              </span>
              <span style={{ flex: 1, minWidth: 160 }}>{job.label || ''}</span>
              <button
                type="button"
                onClick={() => window.electronAPI.cancelMp4Conversion(job.id)}
                style={ghostBtn}
              >
                Cancel
              </button>
            </>
          ) : null}
          {job.status === 'failed' ? (
            <>
              <span style={{ color: 'var(--red)', flex: 1, minWidth: 200 }}>{job.error || 'Failed'}</span>
              <button
                type="button"
                onClick={() => window.electronAPI.retryMp4Conversion(job.id)}
                style={primarySmall}
              >
                Retry
              </button>
            </>
          ) : null}
        </div>
      ))}
    </div>
  )
}

const ghostBtn = {
  padding: '4px 10px',
  borderRadius: 8,
  border: '1px solid var(--border2)',
  background: 'var(--bg3)',
  color: 'var(--text2)',
  fontSize: 11,
  cursor: 'pointer',
}

const primarySmall = {
  padding: '4px 10px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--purple)',
  color: '#fff',
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
}
