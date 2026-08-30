import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * The fields every batch image tool's job needs regardless of what it actually does to the
 * file — a tool-specific job type extends this with its own extras (Image Compressor's
 * per-image `maxDimension`, say) via the `createJob` factory passed to the hook below.
 */
export interface ImageJobBase<TResult extends { url: string }> {
  id: string;
  file: File;
  originalUrl: string;
  status: 'processing' | 'done' | 'error';
  result: TResult | null;
  error: string | null;
}

let jobSeq = 0;
const nextJobId = (prefix: string): string => `${prefix}-${(jobSeq += 1)}`;

interface UseImageJobBatchOptions<TResult extends { url: string }, TJob extends ImageJobBase<TResult>> {
  /** Upper bound on one batch's size — files beyond it are dropped, with `batchError` saying how many. */
  maxFiles: number;
  /** Distinguishes this tool's job ids from another image tool's — cosmetic only, never shown to the user. */
  idPrefix: string;
  /** Builds a job's tool-specific extra fields on top of the shared base fields this hook fills in. */
  createJob: (base: { id: string; file: File; originalUrl: string }) => TJob;
}

/**
 * Owns the batch-of-images bookkeeping that Image Compressor and Image Format Converter
 * both need — adding/removing files with a hard cap, tracking which job is selected for the
 * detail panel, revoking every `createObjectURL` URL exactly once, and race-guarding async
 * processing so an edit to one image can't have a slower, now-stale request for that same
 * image clobber a fresher result.
 *
 * Deliberately does *not* decide when to (re)process a job — batch-wide re-run triggers
 * differ per tool (Image Compressor also reprocesses on a per-image "keep original format"
 * flip that Format Converter has no equivalent of), so that stays the caller's own effect,
 * built on `startJob` / `isCurrentSeq` / `finishJob` / `failJob` below.
 */
export function useImageJobBatch<TResult extends { url: string }, TJob extends ImageJobBase<TResult> = ImageJobBase<TResult>>(
  options: UseImageJobBatchOptions<TResult, TJob>
) {
  const [jobs, setJobs] = useState<TJob[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const seqRef = useRef<Map<string, number>>(new Map());
  const jobsRef = useRef<TJob[]>([]);
  jobsRef.current = jobs;

  const revokeJob = (job: TJob) => {
    URL.revokeObjectURL(job.originalUrl);
    if (job.result) URL.revokeObjectURL(job.result.url);
  };

  useEffect(() => () => jobsRef.current.forEach(revokeJob), []);

  const jobIds = jobs.map((job) => job.id).join(',');
  useEffect(() => {
    // Keeps a valid selection without yanking focus away from what's already selected: fixes
    // up only when the current selection is gone (job removed) or nothing is selected yet
    // (first image just added) — adding more images never steals selection.
    setSelectedJobId((prev) => (prev && jobs.some((job) => job.id === prev) ? prev : (jobs[0]?.id ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobIds]);

  const addFiles = (files: File[]): TJob[] => {
    const room = Math.max(0, options.maxFiles - jobsRef.current.length);
    setBatchError(
      files.length > room
        ? `Only ${options.maxFiles} images can be processed in one batch — ${files.length - room} extra file(s) were skipped.`
        : null
    );
    const accepted = files
      .slice(0, room)
      .map((file) => options.createJob({ id: nextJobId(options.idPrefix), file, originalUrl: URL.createObjectURL(file) }));
    if (accepted.length > 0) setJobs((prev) => [...prev, ...accepted]);
    return accepted;
  };

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job) revokeJob(job);
      return prev.filter((j) => j.id !== id);
    });
  };

  const clearAll = () => {
    jobsRef.current.forEach(revokeJob);
    setJobs([]);
    setBatchError(null);
    setSelectedJobId(null);
  };

  /**
   * Marks a job as (re)processing and bumps its sequence number. The returned sequence is a
   * race guard: check it with `isCurrentSeq` right before committing an async result, so a
   * slower, now-stale request for the same image can't overwrite a fresher one that finished
   * first.
   */
  const startJob = (id: string): number => {
    const seq = (seqRef.current.get(id) ?? 0) + 1;
    seqRef.current.set(id, seq);
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'processing', error: null } : j)));
    return seq;
  };

  const isCurrentSeq = (id: string, seq: number): boolean => seqRef.current.get(id) === seq;

  /** `patch` carries any extra tool-specific fields (e.g. detected original width/height) that should land atomically with the result. */
  const finishJob = (id: string, result: TResult, patch?: Partial<TJob>) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== id) return j;
        if (j.result) URL.revokeObjectURL(j.result.url);
        return { ...j, ...patch, status: 'done', result, error: null };
      })
    );
  };

  const failJob = (id: string, error: string) => {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'error', result: null, error } : j)));
  };

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  return {
    jobs,
    setJobs,
    batchError,
    selectedJobId,
    setSelectedJobId,
    selectedJob,
    addFiles,
    removeJob,
    clearAll,
    startJob,
    isCurrentSeq,
    finishJob,
    failJob,
  };
}
