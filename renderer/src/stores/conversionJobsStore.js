import { create } from 'zustand'

/**
 * Background WebM → MP4 jobs (main process broadcasts updates).
 * @typedef {{ id: string, status: string, percent: number, label?: string, inputPath?: string, outputPath?: string, mp4Path?: string, error?: string, videoCodec?: string }} ConversionJob
 */

export const useConversionJobsStore = create((set, get) => ({
  /** @type {Record<string, ConversionJob>} */
  jobsById: {},

  /** Merge full job snapshot from main process */
  upsertJob(job) {
    if (!job?.id) return
    set((s) => ({
      jobsById: { ...s.jobsById, [job.id]: { ...s.jobsById[job.id], ...job } },
    }))
  },

  removeJob(id) {
    set((s) => {
      const { [id]: _removed, ...rest } = s.jobsById
      return { jobsById: rest }
    })
  },

  /** Jobs still worth showing in UI (not pruned) */
  listActiveOrRecent() {
    return Object.values(get().jobsById).filter((j) =>
      ['queued', 'running', 'failed', 'cancelled'].includes(j.status),
    )
  },
}))
