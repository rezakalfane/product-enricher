import { NextResponse } from 'next/server';
import { all, type ActionKind, type Job } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Poll target for in-flight analyses: `?ids=a,b,c`. */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) return NextResponse.json({ jobs: [], done: true, actions: [] });

  const placeholders = ids.map(() => '?').join(',');
  const jobs = await all<Job>(
    `SELECT id, filename, status, note, created_at FROM jobs WHERE id IN (${placeholders})`,
    ids,
  );
  const actions = await all<{ id: string; job_id: string; kind: ActionKind }>(
    `SELECT id, job_id, kind FROM actions WHERE job_id IN (${placeholders})
     ORDER BY confidence DESC, created_at ASC`,
    ids,
  );

  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a.job_id, (counts.get(a.job_id) ?? 0) + 1);

  return NextResponse.json({
    jobs: jobs.map((j) => ({ ...j, actionCount: counts.get(j.id) ?? 0 })),
    // A job row can lag a moment behind the insert, so treat missing ids as still running.
    done: jobs.length === ids.length && jobs.every((j) => j.status !== 'analyzing'),
    /** Highest confidence first — the order the review modal steps through them. */
    actions: actions.map((a) => ({ id: a.id, kind: a.kind })),
  });
}
