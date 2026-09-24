// Pipedream code step — Workflow B (reply).
// Trigger: HTTP / Webhook → "New Requests". Its URL goes in the app's PIPEDREAM_REPLY_URL.
// Paste this as a Node.js code step after the trigger.
//
// Workflow environment variables:
//   INGEST_SECRET  same value as INGEST_SECRET in the app's .env.local
//
// Product Enricher calls this when a Telegram message has been analyzed; the step replies to
// that message with the summary.

export default defineComponent({
  props: {
    telegram_bot_api: { type: 'app', app: 'telegram_bot_api' },
  },
  async run({ steps, $ }) {
    // Testing in build mode without a selected sample event gives an empty event.
    const { headers = {}, body = {} } = steps.trigger.event ?? {};
    // Only the app knows the secret — reject anything else that finds this URL.
    if (headers['x-ingest-secret'] !== process.env.INGEST_SECRET) {
      await $.respond({ status: 401, body: 'Unauthorized' });
      return $.flow.exit('Bad secret.');
    }
    await $.respond({ status: 200, body: 'ok' });

    const { reply, summary } = body;
    if (!reply?.chat_id) return $.flow.exit('No chat to reply to.');

    const token = this.telegram_bot_api?.$auth?.token;
    if (!token) throw new Error('No Telegram Bot account selected on this step — pick one under Configure, then deploy.');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: reply.chat_id,
        text: summary,
        reply_parameters: { message_id: reply.message_id, allow_sending_without_reply: true },
        link_preview_options: { is_disabled: true },
      }),
    }).then((r) => r.json());
    if (!res.ok) throw new Error(`sendMessage failed: ${res.description}`);
    return { sent: true };
  },
});
