import { NextResponse } from 'next/server';
import { applyAction, markApplied, markFailed } from '@/lib/apply';
import { one, type QueueAction } from '@/lib/db';
import { releaseActionUpload } from '@/lib/retention';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await one<QueueAction>('SELECT * FROM actions WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status === 'applied') {
    return NextResponse.json({ error: 'This action was already applied.' }, { status: 409 });
  }

  try {
    const result = await applyAction(row);
    await markApplied(id, result.message);
    // BigCommerce now holds the image; the local copy is no longer needed.
    await releaseActionUpload(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apply failed.';
    await markFailed(id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
