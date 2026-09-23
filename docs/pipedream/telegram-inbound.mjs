// Pipedream code step — Workflow A (inbound).
// Trigger: Telegram Bot → "New Updates (Instant)". Paste this as a Node.js code step after it.
//
// Workflow environment variables (Settings → Environment variables):
//   INGEST_URL              https://<your-domain>.ngrok-free.app/api/ingest
//   INGEST_SECRET           same value as INGEST_SECRET in the app's .env.local
//   ALLOWED_TELEGRAM_USERS  comma-separated Telegram usernames allowed to use the bot (no @)
//
// Downloads any document or photo on the message and forwards it, with the text or caption,
// to Product Enricher. The app replies later through Workflow B.

export default defineComponent({
  props: {
    telegram_bot_api: { type: 'app', app: 'telegram_bot_api' },
  },
  async run({ steps, $ }) {
    const message = steps.trigger.event.message;
    // Edits, channel posts, joins and other update types carry nothing to analyze.
    if (!message) return $.flow.exit('Not a new message.');

    const allowed = (process.env.ALLOWED_TELEGRAM_USERS ?? '')
      .split(',')
      .map((u) => u.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);
    const sender = (message.from?.username ?? '').toLowerCase();
    // The bot can be found by anyone who knows its username; only forward known senders.
    if (!allowed.includes(sender)) return $.flow.exit(`Sender @${sender || 'unknown'} is not allowed.`);

    const token = this.telegram_bot_api.$auth.token;

    async function download(fileId) {
      const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`).then((r) => r.json());
      if (!meta.ok) throw new Error(`getFile failed: ${meta.description}`);
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      return res.arrayBuffer();
    }

    const form = new FormData();
    form.append('channel', 'telegram');
    form.append('message_id', `${message.chat.id}:${message.message_id}`);
    form.append('reply', JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id }));

    const text = message.text ?? message.caption ?? '';
    if (text) form.append('text', text);

    if (message.document) {
      const d = message.document;
      const buf = await download(d.file_id);
      form.append('files', new Blob([buf], { type: d.mime_type ?? 'application/octet-stream' }), d.file_name ?? `telegram-${d.file_unique_id}`);
    }
    if (message.photo?.length) {
      // Telegram sends several sizes, smallest first.
      const p = message.photo[message.photo.length - 1];
      const buf = await download(p.file_id);
      form.append('files', new Blob([buf], { type: 'image/jpeg' }), `telegram-photo-${p.file_unique_id}.jpg`);
    }

    if (!text && !message.document && !message.photo) {
      return $.flow.exit('Nothing to analyze (sticker, voice note, location…).');
    }

    const res = await fetch(process.env.INGEST_URL, {
      method: 'POST',
      headers: {
        'x-ingest-secret': process.env.INGEST_SECRET,
        // ngrok's free plan can show a browser warning page instead of forwarding; this skips it.
        'ngrok-skip-browser-warning': '1',
      },
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Ingest failed (${res.status}): ${body.error ?? 'unknown error'}`);
    return body;
  },
});
