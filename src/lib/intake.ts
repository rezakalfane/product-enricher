import { after } from 'next/server';
import { analyzeTextSource, analyzeUpload, createJob } from './analyze';
import { sweepOrphanedUploads } from './retention';

export type QueuedJob = { id: string; filename: string };

/**
 * Record a job per source and schedule the analysis in `after()`, once the response is sent.
 * Shared by the dropzone (/api/analyze) and channel ingest (/api/ingest).
 *
 * Sources in one call run sequentially, so a multi-file drop doesn't fan out concurrent model
 * and catalog calls. The hooks run inside the same `after()`: `onStart` before the first source,
 * `onJobDone` as each source finishes, and `onDone` after the whole batch.
 */
export async function queueSources({
  files = [],
  text,
  textName = 'Pasted text',
  label = (name) => name,
  onStart,
  onJobDone,
  onDone,
}: {
  files?: File[];
  text?: string;
  /** Name the text source gets in the queue. */
  textName?: string;
  /** Display name for a source in the queue, e.g. to prefix the channel it came from. */
  label?: (name: string) => string;
  onStart?: (jobs: QueuedJob[]) => Promise<void>;
  onJobDone?: (job: QueuedJob) => Promise<void>;
  onDone?: (jobs: QueuedJob[]) => Promise<void>;
}): Promise<QueuedJob[]> {
  const jobs: QueuedJob[] = [];
  const tasks: { job: QueuedJob; run: () => Promise<void> }[] = [];

  for (const file of files) {
    const mime = file.type || 'application/octet-stream';
    const filename = label(file.name);
    const id = await createJob({ sourceType: 'file', filename, mime });
    // Read the body now — it is not available once the response has been sent.
    const buf = Buffer.from(await file.arrayBuffer());
    const job = { id, filename };
    jobs.push(job);
    // The pipeline sees the original name: filename terms feed product matching.
    tasks.push({ job, run: () => analyzeUpload(id, buf, file.name, mime) });
  }

  // After the attachments, so a caption is reported after the file it describes.
  if (text?.trim()) {
    const filename = label(textName);
    const id = await createJob({ sourceType: 'text', filename, mime: 'text/plain' });
    const job = { id, filename };
    jobs.push(job);
    tasks.push({ job, run: () => analyzeTextSource(id, text, filename) });
  }

  if (tasks.length > 0) {
    after(async () => {
      await onStart?.(jobs);
      for (const task of tasks) {
        await task.run();
        await onJobDone?.(task.job);
      }
      await sweepOrphanedUploads();
      await onDone?.(jobs);
    });
  }

  return jobs;
}
