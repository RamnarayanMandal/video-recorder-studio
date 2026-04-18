/** Display: under 1 MB show KB; 1 MB and up show MB with one decimal. */
export function formatRecordingSize(bytes) {
  const n = Math.max(0, Number(bytes) || 0)
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
