# 🎥 Video Recorder Studio

A modern, high-performance desktop screen recorder built with Electron and React — now with a **floating overlay UI, live preview, and improved stability**.

---

## 🚀 What's New (v1.1.0)

✨ Major UI & Stability Update

* 🪟 **Single Floating Overlay (No duplicate previews)**
* 🎯 **Live Screen + Webcam Preview (no blank window bug)**
* 🎛 **Draggable & Resizable Overlay Window**
* ⏹ **Stop = Full Cleanup (auto close preview)**
* 🎤 **Mic Toggle + Live Audio Level Meter**
* ⏱ **Live Recording Timer**
* 🎮 **Modern Control Bar (REC, Pause, Stop, Drag)**
* ⚡ **Fixed Start Button & Settings Issues**
* 🧠 **Improved State Management (no multiple triggers)**

---

## 🚀 Features

* 🎥 Screen + Webcam Recording
* 🎙 Microphone + System Audio Support
* 🪟 Floating Overlay with Live Preview
* 🎛 Draggable & Resizable Recording Window
* ⚡ Background MP4 Conversion (no waiting)
* 📊 Live File Size Indicator
* ⏱ Real-Time Recording Timer
* 🔊 Audio Level Visualization (Mic)
* 💾 Smart Storage Management
* 🗂 Persistent Folder Selection
* 🎚 Recording Quality Controls

---

## ⬇️ Download

👉 **Download latest version (v1.1.0):**
https://github.com/RamnarayanMandal/video-recorder-studio/releases/tag/v1.1.0

### 📦 Available Builds:

* 🪟 Windows → `.exe`
* 🍎 macOS → `.dmg`
* 🐧 Linux → `.AppImage`

---

## ⚡ Performance Optimizations

* ⚡ Fast encoding using FFmpeg (`veryfast` preset)
* 🚀 Optional GPU acceleration (NVIDIA / Intel)
* 📦 WebM recording for smaller file sizes
* 🔄 Background compression to reduce storage usage
* 🧠 Optimized rendering (no preview freeze on minimize)

---

## 🧠 Smart Features

* 📉 Auto compression (reduce video size up to 70%)
* 🔄 Background processing (non-blocking UI)
* 📊 Real-time progress tracking
* 🔔 Conversion status notifications
* 🛑 Safe recording stop with full cleanup

---

## 🪟 Overlay UI (New)

* Always-on-top floating window
* Clean glassmorphism design
* Bottom control bar:

  * 🔴 REC indicator
  * ⏱ Timer
  * 🎤 Mic toggle
  * 🔊 Audio meter
  * ⏸ Pause
  * ⏹ Stop
* Fully movable anywhere on screen

---

## 🛠 Tech Stack

* Electron
* React (Vite)
* Node.js
* FFmpeg

---

## 📦 Installation (Development)

```bash
git clone https://github.com/RamnarayanMandal/video-recorder-studio.git
cd video-recorder-studio
npm install
npm run dev
```

---

## 🏗 Build Desktop App

```bash
npm run dist
```

---

## 📁 Output

```
dist/
 ├── Setup.exe
 ├── Video Recorder Studio.dmg
 ├── Video Recorder Studio.AppImage
```

---

## ⚙️ Usage

1. Select recording folder
2. Configure screen, camera, and mic
3. Click **Start Recording**
4. Use floating overlay controls
5. Click **Stop** → file saved instantly
6. MP4 conversion runs in background

---

## 📊 Recording Info

* ⏱ Live timer
* 📦 File size growth
* 🔊 Audio level visualization

---

## ⚠️ Notes

* MP4 conversion depends on system performance
* GPU acceleration improves encoding speed
* WebM is recommended for faster recording
* Ensure camera & mic permissions are enabled

---

## 🔮 Future Improvements

* ✂️ Built-in video editor (trim, cut)
* ☁️ Cloud upload integration
* 🧠 AI subtitles generation
* 🔊 AI noise reduction
* ⌨️ Global hotkeys (Start/Stop)

---

## 👨‍💻 Author

Ramnarayan Mandal

---

## 📄 License

MIT License
