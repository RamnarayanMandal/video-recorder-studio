

# 🎥 Video Recorder Studio

A modern desktop video recorder built with Electron and React.

## 🚀 Features

- 🎥 Screen + Webcam Recording
- 🎙 Microphone + System Audio Support
- ⚡ Background MP4 Conversion (no waiting)
- 📊 Live File Size Indicator during recording
- 💾 Smart Storage Management
- 🗂 Folder Selection with persistence
- 🎛 Recording Quality Controls

## ⚡ Performance Optimizations

- Fast encoding using FFmpeg (`veryfast` preset)
- Optional GPU acceleration (NVIDIA / Intel)
- WebM recording for smaller file sizes
- Background compression to reduce storage usage

## 🧠 Smart Features

- Auto compression (reduce video size up to 70%)
- Background processing (non-blocking UI)
- Real-time progress tracking
- Conversion status notifications

## 🛠 Tech Stack

- Electron
- React (Vite)
- Node.js
- FFmpeg

## 📦 Installation (Development)

```bash
git clone https://github.com/your-username/video-recorder-studio.git
cd video-recorder-studio
npm install
npm run dev
```

## 🏗 Build Desktop App

```bash
npm run dist
```

## 📁 Output

```
dist/
 ├── Media Recorder Setup.exe
 ├── Media Recorder.dmg
 ├── Media Recorder.AppImage
```

## ⚙️ Usage

1. Select recording folder
2. Click "Start Recording"
3. Record screen + webcam
4. Stop → file saved instantly
5. MP4 conversion runs in background

## 📊 Recording Info

- Live timer
- File size growth
- Audio level visualization

## ⚠️ Notes

- MP4 conversion may take time depending on system
- GPU acceleration improves performance significantly
- WebM format is recommended for faster recording

## 🔮 Future Improvements

- Video editor (trim, cut)
- Cloud upload integration
- Auto subtitle generation
- AI noise reduction

## 👨‍💻 Author

Ramnarayan Mandal

## 📄 License

# MIT License

# video-recorder-studio

A high-performance desktop video recorder built with Electron and React. Supports screen + webcam recording, background MP4 conversion, live file size tracking, and optimized video compression.



