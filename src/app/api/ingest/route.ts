import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { all, getDb, now, run, type Job } from '@/lib/db';
import { env } from '@/lib/env';
import { queueSources, type QueuedJob } from '@/lib/intake';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MIN_CAPTION_CHARS = 40;

/**
 * Channel ingest: a message from Telegram, Slack, email… relayed by an automation service
 * (Pipedream) as multipart form data.
 *
 *   files[]     attachments, already downloaded by the relay
 *   text        message body or caption
 *   message_id  unique per channel message — retried deliveries are ignored
 *   channel     short name shown in the queue, e.g. "telegram"
 *   reply       opaque JSON echoed back untouched to PIPEDREAM_REPLY_URL (chat and thread ids)
 *
 * Authenticated with the `x-ingest-secret` header. Analysis runs exactly as for the dropzone;
 * nothing is written to BigCommerce until a reviewer applies it in the app.
 */
export async function POST(req: Request) {
  if (!env.ingestSecret) {
    return NextResponse.json({ error: 'Channel ingest is disabled (INGEST_SECRET is not set).' }, { status: 503 });
  }
  if (!secretMatches(req.headers.get('x-ingest-secret'), env.ingestSecret)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const text = String(form.get('text') ?? '').trim();
  const channel = String(form.get('channel') ?? 'channel').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'channel';
  const messageId = String(form.get('message_id') ?? '').slice(0, 200);
  const reply = parseReply(form.get('reply'));

  if (files.length === 0 && !text) {
    return NextResponse.json({ error: 'Nothing to analyze — send text or attachments.' }, { status: 400 });
  }

  const dedupeKey = messageId ? `${channel}:${messageId}` : null;
  if (dedupeKey) {
    const db = await getDb();
    const rs = await db.execute({
      sql: 'INSERT OR IGNORE INTO inbound_messages (id, channel, received_at) VALUES (?, ?, ?)',
      args: [dedupeKey, channel, now()],
    });
    if (rs.rowsAffected === 0) return NextResponse.json({ duplicate: true, jobs: [] });
  }

  try {
    const jobs = await queueSources({
      files,
      // Text sent on its own is always analyzed. A caption on attachments usually just labels
      // them ("see attached"), so it is only analyzed when long enough to carry product data.
      text: files.length === 0 || text.length >= MIN_CAPTION_CHARS ? text : undefined,
      textName: 'message',
      label: (name) => `${channel} · ${name}`,
      onDone: (queued) => reportBack(queued, reply),
    });
    return NextResponse.json({ jobs });
  } catch (err) {
    // Let the relay retry a delivery that never got queued.
    if (dedupeKey) await run('DELETE FROM inbound_messages WHERE id = ?', [dedupeKey]);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ingest failed.' },
      { status: 500 },
    );
  }
}

/** Constant-time comparison; hashing first makes the lengths equal. */
function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function parseReply(value: FormDataEntryValue | null): unknown {
  if (typeof value !== 'string' || !value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Tell the channel how its message went. The destination comes only from configuration,
 * never from the request, so ingest can't be used to make the server call arbitrary URLs.
 */
async function reportBack(queued: QueuedJob[], reply: unknown) {
  if (!env.replyWebhookUrl) return;

  const ids = queued.map((j) => j.id);
  const placeholders = ids.map(() => '?').join(',');
  const jobs = await all<Job & { actionCount: number }>(
    `SELECT j.id, j.filename, j.status, j.note,
            (SELECT COUNT(*) FROM actions a WHERE a.job_id = j.id) AS actionCount
     FROM jobs j WHERE j.id IN (${placeholders})`,
    ids,
  );

  const total = jobs.reduce((n, j) => n + Number(j.actionCount), 0);
  const lines = jobs.map((j) => {
    const name = j.filename.replace(/^[^·]+·\s*/, '');
    if (j.status === 'error') return `⚠️ ${name} — ${j.note ?? 'analysis failed'}`;
    const n = Number(j.actionCount);
    return n > 0 ? `✅ ${name} — ${n} action(s) queued` : `ℹ️ ${name} — ${j.note ?? 'no products found'}`;
  });
  const summary = [
    total > 0 ? `${total} action(s) ready for review.` : 'Nothing to review.',
    ...lines,
    ...(total > 0 ? [`Review: ${env.publicUrl}`] : []),
  ].join('\n');

  try {
    const res = await fetch(env.replyWebhookUrl, {
      method: 'POST',
      // Same shared secret, so the relay can reject callbacks that didn't come from this app.
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': env.ingestSecret ?? '' },
      body: JSON.stringify({
        reply,
        summary,
        actionCount: total,
        reviewUrl: env.publicUrl,
        jobs: jobs.map((j) => ({ ...j, actionCount: Number(j.actionCount) })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[ingest] reply webhook returned ${res.status}`);
  } catch (err) {
    console.error('[ingest] reply webhook failed:', err);
  }
}
