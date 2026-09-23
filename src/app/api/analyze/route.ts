import { NextResponse } from 'next/server';
import { queueSources } from '@/lib/intake';

export const runtime = 'nodejs';
export const maxDuration = 300;

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
      return NextResponse.json({ jobs: await queueSources({ text }) });
    }

    const form = await req.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files received.' }, { status: 400 });
    }
    return NextResponse.json({ jobs: await queueSources({ files }) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Analysis failed.' },
      { status: 500 },
    );
  }
}
