import { NextResponse } from 'next/server';
import { now, one, run, type QueueAction } from '@/lib/db';
import { releaseActionUpload } from '@/lib/retention';
import type { ActionPayload } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Joins the job so the response matches the shape the queue list returns. */
const SELECT_ONE = `
  SELECT a.*, j.filename, j.source_type, j.mime
  FROM actions a JOIN jobs j ON j.id = a.job_id
  WHERE a.id = ?
`;

const hydrate = (row: QueueAction) => ({
  ...row,
  payload: JSON.parse(row.payload),
  candidates: JSON.parse(row.candidates),
});

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const row = await one<QueueAction>(SELECT_ONE, [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(hydrate(row));
}

/** Save reviewer edits: chosen match, edited field values, or a status change. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as {
    product_id?: number | null;
    variant_id?: number | null;
    kind?: QueueAction['kind'];
    status?: QueueAction['status'];
    fields?: ActionPayload['fields'];
  };

  const row = await one<QueueAction>(SELECT_ONE, [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const payload = JSON.parse(row.payload) as ActionPayload;
  if (body.fields) payload.fields = body.fields;

  await run(
    `UPDATE actions
     SET product_id = ?, variant_id = ?, kind = ?, status = ?, payload = ?, updated_at = ?
     WHERE id = ?`,
    [
      body.product_id !== undefined ? body.product_id : row.product_id,
      body.variant_id !== undefined ? body.variant_id : row.variant_id,
      body.kind ?? row.kind,
      body.status ?? row.status,
      JSON.stringify(payload),
      now(),
      id,
    ],
  );

  if (body.status === 'cancelled') await releaseActionUpload(id);

  const updated = await one<QueueAction>(SELECT_ONE, [id]);
  return NextResponse.json(hydrate(updated!));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await releaseActionUpload(id);
  await run('DELETE FROM actions WHERE id = ?', [id]);
  return NextResponse.json({ ok: true });
}
