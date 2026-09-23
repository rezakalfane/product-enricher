# Channels — send sources from chat apps

Send a document, photo, or text to a chat channel and Product Enricher analyzes it exactly as if
it had been dropped into the app. The bot replies in the chat when the analysis is done. Nothing
is written to BigCommerce until someone presses **Apply** in the review modal.

The app exposes one channel-agnostic endpoint, `POST /api/ingest`. An automation service
(Pipedream, free tier) owns everything channel-specific — bot login, downloading attachments,
formatting replies — so adding a channel means adding a workflow, not changing the app.

```
Telegram message ─▶ Pipedream workflow A ─▶ ngrok tunnel ──────▶ POST /api/ingest
                    (download attachments)                          │
                                                                    ▼
                                                     same pipeline as the dropzone
                                                                    │
Telegram reply   ◀─ Pipedream workflow B ◀── POST PIPEDREAM_REPLY_URL ◀┘
```

> **Governance.** Pipedream, Telegram, and the tunnel provider all receive whatever is sent to the
> bot. Use only the synthetic files in `fixtures/` until GRC has reviewed this data flow.

## Telegram setup (~15 minutes)

### 1. App

Add to `.env.local` and restart `npm run dev`:

```bash
INGEST_SECRET=<long random string>        # e.g. openssl rand -hex 24
PIPEDREAM_REPLY_URL=<workflow B URL>      # filled in at step 4
# APP_PUBLIC_URL=http://localhost:3210    # review link in replies (default)
```

`/api/ingest` returns 503 until `INGEST_SECRET` is set.

### 2. Tunnel

**ngrok** (free account). The free plan includes one static domain, so the URL survives restarts
and workflow A never needs updating. Claim it under *Domains* in the ngrok dashboard, then:

```bash
ngrok http 3210 --url https://<your-domain>.ngrok-free.app
```

Don't pass `--host-header=rewrite`. The app decides what a tunnel may reach by the `Host` header,
and rewriting it to `localhost` would expose the whole app.

**Alternative — Cloudflare quick tunnel** (no account, but a new random URL on every restart):

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:3210    # prints https://<random>.trycloudflare.com
```

Either way, only `/api/ingest` is reachable through the tunnel — every other path returns 404
(`src/proxy.ts`), because the app itself has no login.

### 3. Bot

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and username → copy the token.
2. In Pipedream, **Accounts → Connect an app → Telegram Bot**, paste the token.

### 4. Workflow B — reply (create this first, so you have its URL)

1. New workflow → trigger **HTTP / Webhook → New Requests**. In the trigger's settings choose
   **Return a custom response from your workflow**.
2. Add a **Node.js code step** and paste [`pipedream/telegram-reply.mjs`](pipedream/telegram-reply.mjs).
   Select your Telegram Bot account in the step's prop.
3. Workflow settings → environment variable `INGEST_SECRET` (same value as the app).
4. Deploy. Copy the trigger URL into the app's `PIPEDREAM_REPLY_URL` and restart the dev server.

### 5. Workflow A — inbound

1. New workflow → trigger **Telegram Bot → New Updates (Instant)**, using your bot account.
2. Add a **Node.js code step** and paste [`pipedream/telegram-inbound.mjs`](pipedream/telegram-inbound.mjs).
   Select your Telegram Bot account in the step's prop.
3. Environment variables:
   - `INGEST_URL` — `https://<your-domain>.ngrok-free.app/api/ingest` (or your trycloudflare URL)
   - `INGEST_SECRET` — same value as the app
   - `ALLOWED_TELEGRAM_USERS` — comma-separated Telegram usernames allowed to use the bot
4. Deploy.

### 6. Try it

Open a chat with your bot and send:

- `fixtures/docs/q4-2026-trade-price-list.pdf` (as a file)
- a packshot from `fixtures/images/` (as a photo)
- a text message describing a product

Each appears in the app's action queue as `telegram · <name>` within a few seconds. When analysis
finishes, the bot replies to your message, for example:

```
4 action(s) ready for review.
✅ q4-2026-trade-price-list.pdf — 4 action(s) queued
Review: http://localhost:3210
```

## Behaviour

| Message | What gets analyzed |
| --- | --- |
| Text only | The text |
| Document or photo | The attachment |
| Attachment with a caption of 40+ characters | Both — the caption as its own text source |
| Attachment with a short caption ("see attached") | The attachment only |
| Sticker, voice note, location… | Nothing (workflow A exits) |
| Sender not in `ALLOWED_TELEGRAM_USERS` | Nothing (workflow A exits) |

- **Send packshots as a file**, not as a photo. A Telegram photo is compressed and renamed to
  `telegram-photo-<id>.jpg`, so it loses the descriptive filename (`anarchist-black-0mg-100ml…`)
  that is one of the strongest matching signals. The same packshot matches at 100% as a file, but
  only surfaces as a low-confidence candidate as a photo when the flavour isn't legible on the label.
- **Albums** arrive as one update per item, so each item gets its own reply.
- **Retries** are safe: the app ignores a `message_id` it has already accepted.
- Telegram bots can download files up to **20 MB**.

## Ingest contract

For adding other channels (Slack, Gmail, WhatsApp via a Meta app). Full details in
[DETAILS.md § Channel ingest](DETAILS.md#channel-ingest).

`POST /api/ingest` — `multipart/form-data`, header `x-ingest-secret: <INGEST_SECRET>`

| Field | Required | Meaning |
| --- | --- | --- |
| `files` | one of `files` / `text` | Attachments (repeatable) |
| `text` | one of `files` / `text` | Message body or caption |
| `channel` | no | Short name shown in the queue (`[a-z0-9_-]`, default `channel`) |
| `message_id` | recommended | Unique per channel message; duplicates return `{ duplicate: true }` |
| `reply` | no | Opaque JSON, echoed back to `PIPEDREAM_REPLY_URL` |

Responses: `200 { jobs }`, `200 { duplicate: true }`, `400` nothing to analyze, `401` bad secret,
`503` ingest disabled.

When the message's sources finish, the app POSTs JSON to `PIPEDREAM_REPLY_URL` with header
`x-ingest-secret`:

```json
{
  "reply": { "chat_id": 123, "message_id": 45 },
  "summary": "1 action(s) ready for review.\n✅ message — 1 action(s) queued\nReview: http://localhost:3210",
  "actionCount": 1,
  "reviewUrl": "http://localhost:3210",
  "jobs": [{ "id": "…", "filename": "telegram · message", "status": "done", "note": "…", "actionCount": 1 }]
}
```
