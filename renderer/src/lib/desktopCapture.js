/**
 * Electron/Chromium desktop capture via desktopCapturer source id.
 * (Equivalent to choosing a source; getDisplayMedia() is also available but
 * does not integrate with a custom source list from desktopCapturer.)
 */
export async function getDesktopMediaStream(sourceId, {
  width,
  height,
  frameRate,
  withSystemAudio,
}) {
  const video = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: width,
      maxHeight: height,
      maxFrameRate: frameRate,
    },
  }

  const audio = withSystemAudio
    ? {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      }
    : false

  return navigator.mediaDevices.getUserMedia({ video, audio })
}

/** Optional: native picker + system audio when supported (Chromium). */
export async function getDisplayMediaStream({ width, height, frameRate, withSystemAudio }) {
  return navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: frameRate },
    },
    audio: withSystemAudio,
  })
}
