import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { KIND_LABEL } from '@/lib/client-types';
import { all, getDb, now, one, run, type ActionKind, type Job } from '@/lib/db';
import { env } from '@/lib/env';
import { queueSources } from '@/lib/intake';

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
 * Progress goes back to PIPEDREAM_REPLY_URL as it happens: `received` when the analysis starts,
 * `processed` as each source finishes, and `done` after a message with several sources.
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

  // Text sent on its own is always analyzed. A caption on attachments usually just labels
  // them ("see attached"), so it is only analyzed when long enough to carry product data.
  const analyzeText = files.length === 0 || text.length >= MIN_CAPTION_CHARS;
  const notify = (event: ReplyEvent, message: string, extra?: object) =>
    sendReply({ event, reply, summary: message, ...extra });

  try {
    const jobs = await queueSources({
      files,
      text: analyzeText ? text : undefined,
      textName: files.length ? 'Caption' : 'Message',
      label: (name) => `${channel} · ${name}`,
      onStart: () => notify('received', receivedMessage(files, analyzeText)),
      onJobDone: async (job) => {
        const result = await jobResult(job.id);
        if (result) await notify('processed', processedMessage(result), { job: result });
      },
      onDone: async (queued) => {
        // One source already got a complete "processed" reply; only sum up multi-source messages.
        if (queued.length < 2) return;
        const results = (await Promise.all(queued.map((j) => jobResult(j.id)))).filter((r) => r !== null);
        await notify('done', doneMessage(results), { jobs: results });
      },
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

type ReplyEvent = 'received' | 'processed' | 'done';

type JobResult = {
  id: string;
  name: string;
  status: Job['status'];
  note: string | null;
  actions: { kind: ActionKind; title: string; confidence: number }[];
};

/** Chat apps rename photos to opaque ids (telegram-photo-AQADjh….jpg); just call those "Photo". */
const displayName = (name: string) => (/^[a-z]+-photo-/i.test(name) ? 'Photo' : name);

/** Friendly name for what arrived, from the file's MIME type or extension. */
function kindOf(file: File): string {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (/\.docx?$/.test(name)) return 'Word document';
  if (/\.(csv|tsv|xlsx?)$/.test(name)) return 'Spreadsheet';
  if (file.type.startsWith('image/')) return 'Image';
  if (file.type.startsWith('text/') || name.endsWith('.txt')) return 'Text file';
  return 'File';
}

function receivedMessage(files: File[], withText: boolean): string {
  const lines = files.map((f) =>
    displayName(f.name) === 'Photo' ? '📥 Photo received' : `📥 ${kindOf(f)} received: ${f.name}`,
  );
  if (withText) lines.push(files.length ? '📥 Caption received' : '📥 Message received');
  lines.push(files.length + (withText ? 1 : 0) > 1 ? 'Analyzing them now…' : 'Analyzing now…');
  return lines.join('\n');
}

async function jobResult(id: string): Promise<JobResult | null> {
  const job = await one<Job>('SELECT id, filename, status, note FROM jobs WHERE id = ?', [id]);
  if (!job) return null;
  const actions = await all<{ kind: ActionKind; title: string; confidence: number }>(
    'SELECT kind, title, confidence FROM actions WHERE job_id = ? ORDER BY confidence DESC',
    [id],
  );
  return {
    id: job.id,
    // Drop the "<channel> · " prefix — the chat already knows where it sent it.
    name: displayName(job.filename.replace(/^[^·]+·\s*/, '')),
    status: job.status,
    note: job.note,
    actions: actions.map((a) => ({ ...a, confidence: Number(a.confidence) })),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "10 updates, 2 new products" — what the actions would do, grouped by kind. */
function breakdown(actions: JobResult['actions']): string {
  const counts = new Map<ActionKind, number>();
  for (const a of actions) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  const words: Record<ActionKind, string> = {
    update_product: 'update',
    create_product: 'new product',
    add_product_image: 'product image',
    set_variant_image: 'variant image',
  };
  return [...counts].map(([kind, n]) => plural(n, words[kind])).join(', ');
}

const MAX_LISTED = 3;

function processedMessage(r: JobResult): string {
  if (r.status === 'error') return `⚠️ ${r.name} could not be processed: ${r.note ?? 'unknown error'}`;
  if (r.actions.length === 0) return `ℹ️ ${r.name} processed: nothing to review. ${r.note ?? ''}`.trim();

  const lines = [`✅ ${r.name} processed: ${plural(r.actions.length, 'action')} (${breakdown(r.actions)})`];
  for (const a of r.actions.slice(0, MAX_LISTED)) {
    const score = a.kind === 'create_product' ? '' : ` (${Math.round(a.confidence * 100)}%)`;
    lines.push(`• ${KIND_LABEL[a.kind]}: ${a.title}${score}`);
  }
  if (r.actions.length > MAX_LISTED) lines.push(`• …and ${r.actions.length - MAX_LISTED} more`);
  lines.push(`Review: ${env.publicUrl}`);
  return lines.join('\n');
}

function doneMessage(results: JobResult[]): string {
  const total = results.reduce((n, r) => n + r.actions.length, 0);
  const failed = results.filter((r) => r.status === 'error').length;
  return [
    `🏁 All done: ${plural(results.length, 'source')} processed.`,
    total > 0 ? `${plural(total, 'action')} ready for review: ${env.publicUrl}` : 'Nothing to review.',
    ...(failed > 0 ? [`${failed} could not be processed (see above).`] : []),
  ].join('\n');
}

/**
 * Post a progress update back to the channel. The destination comes only from configuration,
 * never from the request, so ingest can't be used to make the server call arbitrary URLs.
 * `summary` is the ready-to-send message text; the relay posts it as-is.
 */
async function sendReply(body: { event: ReplyEvent; reply: unknown; summary: string } & object) {
  if (!env.replyWebhookUrl) return;
  try {
    const res = await fetch(env.replyWebhookUrl, {
      method: 'POST',
      // Same shared secret, so the relay can reject callbacks that didn't come from this app.
      headers: { 'Content-Type': 'application/json', 'x-ingest-secret': env.ingestSecret ?? '' },
      body: JSON.stringify({ ...body, reviewUrl: env.publicUrl }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[ingest] reply webhook returned ${res.status}`);
  } catch (err) {
    console.error('[ingest] reply webhook failed:', err);
  }
}
