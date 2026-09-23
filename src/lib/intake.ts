import { after } from 'next/server';
import { analyzeTextSource, analyzeUpload, createJob } from './analyze';
import { sweepOrphanedUploads } from './retention';

export type QueuedJob = { id: string; filename: string };

/**
 * Record a job per source and schedule the analysis in `after()`, once the response is sent.
 * Shared by the dropzone (/api/analyze) and channel ingest (/api/ingest).
 *
 * Sources in one call run sequentially, so a multi-file drop doesn't fan out concurrent model
 * and catalog calls. `onDone` runs after the whole batch, inside the same `after()`.
 */
export async function queueSources({
  files = [],
  text,
  textName = 'Pasted text',
  label = (name) => name,
  onDone,
}: {
  files?: File[];
  text?: string;
  /** Name the text source gets in the queue. */
  textName?: string;
  /** Display name for a source in the queue, e.g. to prefix the channel it came from. */
  label?: (name: string) => string;
  onDone?: (jobs: QueuedJob[]) => Promise<void>;
}): Promise<QueuedJob[]> {
  const jobs: QueuedJob[] = [];
  const tasks: (() => Promise<void>)[] = [];

  if (text?.trim()) {
    const filename = label(textName);
    const id = await createJob({ sourceType: 'text', filename, mime: 'text/plain' });
    jobs.push({ id, filename });
    tasks.push(() => analyzeTextSource(id, text, filename));
  }

  for (const file of files) {
    const mime = file.type || 'application/octet-stream';
    const filename = label(file.name);
    const id = await createJob({ sourceType: 'file', filename, mime });
    // Read the body now — it is not available once the response has been sent.
    const buf = Buffer.from(await file.arrayBuffer());
    jobs.push({ id, filename });
    // The pipeline sees the original name: filename terms feed product matching.
    tasks.push(() => analyzeUpload(id, buf, file.name, mime));
  }

  if (tasks.length > 0) {
    after(async () => {
      for (const task of tasks) await task();
      await sweepOrphanedUploads();
      await onDone?.(jobs);
    });
  }

  return jobs;
}
