# Product Enricher

Drop documents, spec sheets, price lists, or product photos into the app. It reads them,
finds the products inside, matches them against a BigCommerce channel, and queues reviewable
create/update actions that you approve before anything is written back.

- **Store:** `flawless` — Flawless Demo (`ufbonfrcnz`)
- **Channel:** Flawless Vape UK Distribution (`1`) — 1,607 products
- **Model:** `gpt-5.6-luna`, `reasoning_effort=low` (both configurable in `.env.local`)

For architecture and implementation details, see **[docs/DETAILS.md](docs/DETAILS.md)**.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in BIGCOMMERCE_ACCESS_TOKEN and OPENAI_API_KEY
npm run dev                  # http://localhost:3210
```

Requires Node 20+. Run from the repo root — OCR reads its language data from `./ocr`.

## What it does

| Input | Pipeline |
| --- | --- |
| PDF / DOCX / CSV / TXT | text extraction → document analysis → per-product match → queue |
| JPG / PNG / WEBP (packshot) | OCR (`tesseract.js`) + filename terms + vision analysis → match → queue |
| JPG / PNG (photo of a page or handwritten note) | vision triage detects a document, transcribes it, then runs the document pipeline |
| Pasted text | same as documents |

- **Background analysis.** An upload returns in ~70ms. The work runs in Next's `after()` and
  each source shows up in the action queue as **Analyzing** until it finishes. The dropzone stays
  usable, so you can keep adding files.
- **Two-stage matching.** An exact SKU (or variant SKU) lookup short-circuits the model; otherwise
  the channel is keyword-searched and the model scores the shortlist.
- **Only new information.** Values that already match the catalog are dropped before an action is
  queued.
- **Human approval.** Nothing reaches BigCommerce until you press **Apply** in the review modal,
  where you can re-point the action at another product or variant, edit values, or drop fields.

## Configuration

Every key is documented in [`.env.example`](.env.example).

| Variable | Required | Default |
| --- | --- | --- |
| `BIGCOMMERCE_STORE_HASH` | yes | — |
| `BIGCOMMERCE_ACCESS_TOKEN` | yes | — |
| `BIGCOMMERCE_CHANNEL_ID` / `BIGCOMMERCE_CHANNEL_NAME` | no | `1` / `Default channel` |
| `OPENAI_API_KEY` | yes | — |
| `OPENAI_MODEL` / `OPENAI_VISION_MODEL` | no | `gpt-5.6-luna` |
| `OPENAI_REASONING_EFFORT` | no | `low` |
| `DATABASE_PATH` / `UPLOAD_DIR` | no | `./data/enricher.db` / `./data/uploads` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | deployed only | — |
| `BLOB_READ_WRITE_TOKEN` | deployed only | — |

## Storage

The data layer is switched by environment variables, so local dev and a deployment run the same
code:

| | Local (default) | Configured |
| --- | --- | --- |
| Queue | SQLite file at `DATABASE_PATH` | Turso, via `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` |
| Uploads | `UPLOAD_DIR` on disk | Private Vercel Blob, via `BLOB_READ_WRITE_TOKEN` |

On Vercel the app refuses to start unless all three remote variables are set.

## File retention

Uploaded files are kept only while they are still needed:

| Source | Stored? |
| --- | --- |
| PDF / DOCX / CSV / TXT | **Never written to storage** — text is extracted in memory and discarded |
| Pasted text | Never written to storage |
| Photo of a document or handwritten note | Deleted immediately after transcription; only the filename is kept |
| Image that matches no product | Deleted immediately |
| Product packshot queued for upload | Kept only until its action is applied, cancelled, or deleted |

An orphan sweep runs after every analysis. What persists is the extracted *text* — field values
and the source sentence quoted as evidence — not the original file.

## Deployment

The code is ready for Vercel + Turso + Vercel Blob. Deployment is **on hold pending GRC review**
([submit here](https://bigcommercecloud.atlassian.net/servicedesk/customer/portal/5/group/1116)).
The app has no authentication of its own, so a deployment needs Vercel Deployment Protection or an
auth layer in front of it. See [docs/DETAILS.md § Deployment](docs/DETAILS.md#deployment).

## Fixtures

```bash
npm run fixtures:images   # 50 product images → fixtures/images/ + images-manifest.json
npm run fixtures:strip    # remove those images from every other product (--dry to preview)
npm run fixtures:docs     # regenerate the DOCX / PDF / CSV supplier documents
npm run fixtures:note     # regenerate the handwritten buyer's note
```

`fixtures/docs/` holds synthetic supplier spec sheets, a Q4 price list, a data-correction email,
a new-line notification, and photographed handwritten buyer's notes. The spec sheets and price
list cite **real products** in the channel (update path); the new-line documents describe invented
products (create path). `fixtures/images-manifest.json` marks the 25 images removed from the store —
re-upload one and it should match straight back to its product.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server on port 3210 |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run docs:diagrams` | Re-render `docs/diagrams/schema.svg` with Mermaid CLI |
