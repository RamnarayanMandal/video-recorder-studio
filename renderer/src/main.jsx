import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { OverlayApp } from './OverlayApp.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {window.electronAPI?.windowRole === 'overlay' || window.location.hash === '#overlay' || window.location.pathname === '/overlay'
      ? <OverlayApp />
      : <App />}
  </React.StrictMode>
)
