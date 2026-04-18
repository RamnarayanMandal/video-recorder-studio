const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getPrimaryScreen: () => ipcRenderer.invoke('get-primary-screen'),
  getDisplaySources: () => ipcRenderer.invoke('get-display-sources'),
  pickSaveFolder: () => ipcRenderer.invoke('pick-save-folder'),
  saveRecording: (opts) => ipcRenderer.invoke('save-recording', opts),
  folderExists: (folderPath) => ipcRenderer.invoke('folder-exists', folderPath),
  openFile: (filepath) => ipcRenderer.invoke('open-file', filepath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),
  showItemInFolder: (filepath) => ipcRenderer.invoke('show-item-in-folder', filepath),
  listRecordings: (folder) => ipcRenderer.invoke('list-recordings', folder),

  getStorageStats: (folder) => ipcRenderer.invoke('get-storage-stats', folder),
  canStartRecording: (folder) => ipcRenderer.invoke('can-start-recording', folder),
  recordingSessionStart: () => ipcRenderer.invoke('recording-session-start'),
  recordingSessionAppend: (payload) => ipcRenderer.invoke('recording-session-append', payload),
  recordingSessionEnd: (sessionId) => ipcRenderer.invoke('recording-session-end', sessionId),
  discardTempRecording: (tmpPath) => ipcRenderer.invoke('discard-temp-recording', tmpPath),
  finalizeTempRecording: (opts) => ipcRenderer.invoke('finalize-temp-recording', opts),
  compressVideoFile: (opts) => ipcRenderer.invoke('compress-video-file', opts),
  deleteFiles: (paths) => ipcRenderer.invoke('delete-files', paths),
  listRecordingsDetailed: (folder, opts) =>
    ipcRenderer.invoke('list-recordings-detailed', folder, opts),
  libraryMetaGet: (folder) => ipcRenderer.invoke('library-meta-get', folder),
  libraryMetaSet: (opts) => ipcRenderer.invoke('library-meta-set', opts),
  librarySetTag: (opts) => ipcRenderer.invoke('library-set-tag', opts),
  libraryAutoCleanup: (opts) => ipcRenderer.invoke('library-auto-cleanup', opts),

  /** Subscribe to save progress during finalize (returns unsubscribe). */
  onFinalizeSaveProgress: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('finalize-save-progress', handler)
    return () => ipcRenderer.removeListener('finalize-save-progress', handler)
  },

  mp4EncoderCapabilities: () => ipcRenderer.invoke('mp4-encoder-capabilities'),
  cancelMp4Conversion: (jobId) => ipcRenderer.invoke('cancel-mp4-conversion', jobId),
  retryMp4Conversion: (jobId) => ipcRenderer.invoke('retry-mp4-conversion', jobId),

  /** Background WebM→MP4 job updates `{ job }` (returns unsubscribe). */
  onConversionJobUpdate: (callback) => {
    const handler = (_event, data) => callback(data)
    ipcRenderer.on('conversion-job-update', handler)
    return () => ipcRenderer.removeListener('conversion-job-update', handler)
  },
})
