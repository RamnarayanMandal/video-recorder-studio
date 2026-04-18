/**
 * Mix microphone and/or system (desktop) audio into one MediaStream using Web Audio API.
 */
export function createMixedAudioOutput({
  micStream,
  systemAudioTrack,
  micEnabled,
  systemEnabled,
}) {
  const ctx = new AudioContext()
  const destination = ctx.createMediaStreamDestination()
  let connected = 0

  if (micEnabled && micStream) {
    const at = micStream.getAudioTracks()[0]
    if (at && at.readyState === 'live') {
      ctx.createMediaStreamSource(new MediaStream([at])).connect(destination)
      connected++
    }
  }

  if (systemEnabled && systemAudioTrack && systemAudioTrack.readyState === 'live') {
    ctx.createMediaStreamSource(new MediaStream([systemAudioTrack])).connect(destination)
    connected++
  }

  if (connected === 0) {
    ctx.close().catch(() => {})
    return { stream: null, audioContext: null }
  }

  return { stream: destination.stream, audioContext: ctx }
}
