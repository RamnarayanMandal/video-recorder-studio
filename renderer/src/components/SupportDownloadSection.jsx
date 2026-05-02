import { useMemo, useState } from 'react'

const PHONE = '6352396301'
const EMAIL = 'ramnarayan847230@gmail.com'

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6.9 2.5h3.2l1.1 5-2 1.9a17.1 17.1 0 0 0 5.3 5.3l1.9-2 5 1.1v3.2c0 .8-.6 1.4-1.4 1.5A17.8 17.8 0 0 1 4 4c0-.8.6-1.4 1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4.2 6.5 7 6c.5.4 1.2.4 1.7 0l7-6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M8 18H5a2 2 0 0 1-2-2V6c0-1.1.9-2 2-2h14a2 2 0 0 1 2 2v10c0 1.1-.9 2-2 2h-6l-5 3v-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlatformIcon({ kind }) {
  if (kind === 'windows') return <span aria-hidden="true">🪟</span>
  if (kind === 'mac') return <span aria-hidden="true"></span>
  return <span aria-hidden="true">🐧</span>
}

export function SupportDownloadSection() {
  const [copiedKey, setCopiedKey] = useState('')

  const platforms = useMemo(
    () => [
      { id: 'windows', label: 'Windows', file: '.exe', size: '98 MB', cta: 'Download for Windows' },
      { id: 'mac', label: 'macOS', file: '.dmg', size: '112 MB', cta: 'Download for macOS' },
      { id: 'linux', label: 'Linux', file: '.AppImage', size: '105 MB', cta: 'Download for Linux' },
    ],
    []
  )

  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 1200)
    } catch {
      setCopiedKey('')
    }
  }

  return (
    <section className="marketing-wrap" aria-label="Support and download">
      <div className="support-grid">
        <div className="support-left">
          <span className="pill">Support</span>
          <h2>Need help with Video Recorder Studio?</h2>
          <p>
            Friendly human support for setup, recording issues, and export help. We keep responses clear,
            practical, and fast so you can get back to creating.
          </p>
          <div className="support-meta">
            <span className="pill pill-success">Response within 24 hours</span>
            <span className="pill">Human support</span>
          </div>
          <div className="illustration" aria-hidden="true">
            <div className="screen" />
            <div className="rec-dot" />
            <div className="chat-bubble" />
          </div>
        </div>

        <div className="support-right">
          <article className="glass-card lift-card">
            <header>
              <div className="card-icon">
                <PhoneIcon />
              </div>
              <div>
                <h3>Call Support</h3>
                <p>Speak directly for urgent help</p>
              </div>
            </header>
            <div className="contact-value">{PHONE}</div>
            <div className="card-actions">
              <a className="btn btn-primary" href={`tel:${PHONE}`}>
                Call Now
              </a>
              <button className="btn btn-secondary" onClick={() => copyText('phone', PHONE)} type="button">
                {copiedKey === 'phone' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </article>

          <article className="glass-card lift-card">
            <header>
              <div className="card-icon">
                <MailIcon />
              </div>
              <div>
                <h3>Email Support</h3>
                <p>Best for detailed questions and attachments</p>
              </div>
            </header>
            <div className="contact-value">{EMAIL}</div>
            <div className="card-actions">
              <a className="btn btn-primary" href={`mailto:${EMAIL}`}>
                Send Email
              </a>
              <button className="btn btn-secondary" onClick={() => copyText('email', EMAIL)} type="button">
                {copiedKey === 'email' ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </article>

          <article className="glass-card disabled-card" aria-disabled="true">
            <header>
              <div className="card-icon">
                <ChatIcon />
              </div>
              <div>
                <h3>Live Chat</h3>
                <p>Real-time support directly in app</p>
              </div>
              <span className="pill">Coming Soon</span>
            </header>
          </article>
        </div>
      </div>

      {/* <div className="download-wrap">
        <div className="download-head">
          <div>
            <h2>Download Video Recorder Studio</h2>
            <p>Free, fast, and powerful screen recorder for Windows, macOS, and Linux</p>
          </div>
          <div className="download-badges">
            <span className="pill">Trusted by creators</span>
            <span className="pill pill-accent">v2.3.5</span>
          </div>
        </div>

        <div className="platform-grid">
          {platforms.map((platform) => (
            <article key={platform.id} className="glass-card lift-card">
              <div className="platform-top">
                <div className="platform-name">
                  <span className="platform-icon">
                    <PlatformIcon kind={platform.id} />
                  </span>
                  <strong>{platform.label}</strong>
                </div>
                <span className="pill">{platform.file}</span>
              </div>
              <p className="platform-size">Installer size: {platform.size}</p>
              <button className="btn btn-primary" type="button">
                {platform.cta}
              </button>
            </article>
          ))}
        </div>

        <div className="app-icon-card glass-card">
          <div className="app-icon-preview" aria-hidden="true">
            <div className="inner-symbol">
              <span className="rec-badge" />
              <span className="frame" />
            </div>
          </div>
          <div>
            <h3>App Icon / Branding</h3>
            <p>Minimal futuristic icon with REC dot + capture frame, optimized for small-size recognition.</p>
            <div className="icon-formats">
              <span className="pill">Windows .ico</span>
              <span className="pill">macOS .icns</span>
              <span className="pill">Linux .png</span>
            </div>
          </div>
        </div>
      </div> */}
    </section>
  )
}
