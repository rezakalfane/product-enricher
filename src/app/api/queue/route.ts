import { NextResponse } from 'next/server';
import { all, batch, now, run, type Job, type QueueAction } from '@/lib/db';
import { releaseAllUploads, releaseUploads } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get('status');
  const filtered = Boolean(status && status !== 'all');

  const rows = await all<QueueAction & { filename: string }>(
    `SELECT a.*, j.filename, j.source_type, j.mime
     FROM actions a JOIN jobs j ON j.id = a.job_id
     ${filtered ? 'WHERE a.status = ?' : ''}
     ORDER BY a.created_at DESC, a.confidence DESC`,
    filtered ? [status] : undefined,
  );

  const countRows = await all<{ status: string; n: number }>(
    'SELECT status, COUNT(*) AS n FROM actions GROUP BY status',
  );

  /*
   * Sources that have no reviewable row of their own: still analyzing, or finished without
   * producing one (an error, or a document with no products in it). Without these the queue
   * looks empty while work is in flight, and a failed upload vanishes silently.
   */
  const inFlight = await all<Job & { actionCount: number }>(
    `SELECT j.id, j.filename, j.status, j.note, j.created_at,
            (SELECT COUNT(*) FROM actions a WHERE a.job_id = j.id) AS actionCount
     FROM jobs j
     WHERE j.status = 'analyzing'
        OR (j.status IN ('error', 'done')
            AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.job_id = j.id))
     ORDER BY j.created_at DESC
     LIMIT 25`,
  );

  return NextResponse.json({
    actions: rows.map((r) => ({
      ...r,
      payload: JSON.parse(r.payload),
      candidates: JSON.parse(r.candidates),
    })),
    jobs: inFlight.map((j) => ({ ...j, actionCount: Number(j.actionCount) })),
    counts: Object.fromEntries(countRows.map((r) => [r.status, Number(r.n)])),
  });
}

/** Bulk operations from the queue toolbar. */
export async function PATCH(req: Request) {
  const { ids, status } = (await req.json()) as { ids: string[]; status: 'cancelled' | 'pending' };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No actions selected.' }, { status: 400 });
  }
  if (status === 'cancelled') await releaseUploads(ids);

  const ts = now();
  await batch(
    ids.map((id) => ({
      sql: 'UPDATE actions SET status = ?, updated_at = ? WHERE id = ?',
      args: [status, ts, id],
    })),
  );
  return NextResponse.json({ updated: ids.length });
}

export async function DELETE() {
  await releaseAllUploads();
  await run('DELETE FROM actions');
  await run('DELETE FROM jobs');
  return NextResponse.json({ ok: true });
}
