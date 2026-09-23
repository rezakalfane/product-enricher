import { after, NextResponse } from 'next/server';
import { analyzeTextSource, analyzeUpload, createJob } from '@/lib/analyze';
import { sweepOrphanedUploads } from '@/lib/retention';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Queued = { id: string; filename: string };

/**
 * Accepts multipart uploads or a JSON `{ text }` body.
 *
 * Jobs are recorded and returned immediately; the analysis itself runs in `after()`, once the
 * response has been sent. The client polls /api/jobs for completion. This keeps the request
 * short regardless of how long a large PDF takes, instead of holding the connection open.
 */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const { text } = (await req.json()) as { text?: string };
      if (!text?.trim()) {
        return NextResponse.json({ error: 'Paste some product information first.' }, { status: 400 });
      }
      const id = await createJob({
        sourceType: 'text',
        filename: 'Pasted text',
        mime: 'text/plain',
      });
      after(() => analyzeTextSource(id, text, 'Pasted text'));
      return NextResponse.json({ jobs: [{ id, filename: 'Pasted text' }] satisfies Queued[] });
    }

    const form = await req.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files received.' }, { status: 400 });
    }

    const jobs: Queued[] = [];
    const tasks: (() => Promise<void>)[] = [];

    for (const file of files) {
      const mime = file.type || 'application/octet-stream';
      const id = await createJob({ sourceType: 'file', filename: file.name, mime });
      // Read the body now — it is not available once the response has been sent.
      const buf = Buffer.from(await file.arrayBuffer());
      jobs.push({ id, filename: file.name });
      tasks.push(() => analyzeUpload(id, buf, file.name, mime));
    }

    // Sequential, so a multi-file drop doesn't fan out concurrent model and catalog calls.
    after(async () => {
      for (const task of tasks) await task();
      await sweepOrphanedUploads();
    });

    return NextResponse.json({ jobs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed.' },
      { status: 500 },
    );
  }
}
