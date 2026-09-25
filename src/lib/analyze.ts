import { randomUUID } from 'node:crypto';
import { analyzeDocument, analyzeImage } from './ai';
import { all, batch, now, run } from './db';
import { classify, extractText, ocrImage, termsFromFilename } from './extract';
import { findMatches, pruneExistingVariants, pruneUnchangedFields } from './match';
import { catalogPrice, priceFields, withoutPriceFields } from './prices';
import { deleteUpload, putUpload } from './storage';
import type { ActionPayload, MatchCandidate, ProposedField, ProposedVariant } from './types';

type Insert = {
  kind: 'create_product' | 'update_product' | 'add_product_image' | 'set_variant_image';
  title: string;
  summary: string;
  confidence: number;
  productId: number | null;
  variantId: number | null;
  payload: ActionPayload;
  candidates: MatchCandidate[];
};

async function insertActions(jobId: string, rows: Insert[]): Promise<string[]> {
  const ts = now();
  const ids: string[] = [];
  await batch(
    rows.map((r) => {
      const id = randomUUID();
      ids.push(id);
      return {
        sql: `INSERT INTO actions (id, job_id, kind, status, title, summary, confidence,
                                   product_id, variant_id, payload, candidates, created_at, updated_at)
              VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          jobId,
          r.kind,
          r.title,
          r.summary,
          r.confidence,
          r.productId,
          r.variantId,
          JSON.stringify(r.payload),
          JSON.stringify(r.candidates),
          ts,
          ts,
        ],
      };
    }),
  );
  return ids;
}

/** Action ids queued by a job, oldest first — used to open the review modal after analysis. */
export async function actionIdsForJobs(jobIds: string[]): Promise<string[]> {
  if (jobIds.length === 0) return [];
  const placeholders = jobIds.map(() => '?').join(',');
  const rows = await all<{ id: string }>(
    `SELECT id FROM actions WHERE job_id IN (${placeholders})
     ORDER BY confidence DESC, created_at ASC`,
    jobIds,
  );
  return rows.map((r) => r.id);
}

export async function createJob(args: {
  sourceType: 'file' | 'text';
  filename: string;
  mime: string;
}): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO jobs (id, source_type, filename, mime, status, created_at)
     VALUES (?, ?, ?, ?, 'analyzing', ?)`,
    [id, args.sourceType, args.filename, args.mime, now()],
  );
  return id;
}

async function finishJob(id: string, status: 'done' | 'error', note?: string) {
  await run('UPDATE jobs SET status = ?, note = ? WHERE id = ?', [status, note ?? null, id]);
}

/** Analyze a document or pasted text and queue one action per product found. */
export async function analyzeTextSource(
  jobId: string,
  text: string,
  filename: string,
  sourceImage?: { filename: string },
) {
  try {
    if (!text.trim()) {
      await finishJob(jobId, 'error', 'No readable text found in this source.');
      return;
    }
    const doc = await analyzeDocument(text, filename);
    if (doc.products.length === 0) {
      await finishJob(jobId, 'done', `No products identified in this ${doc.documentType}.`);
      return;
    }

    const rows: Insert[] = [];
    for (const p of doc.products) {
      const described =
        `Name: ${p.name}\nSKU: ${p.sku ?? '—'}\nBrand: ${p.brand ?? '—'}\n` +
        `Price: ${catalogPrice(p.prices) ?? '—'}\nRRP: ${p.prices.retail?.value ?? '—'}\n` +
        `Variant: ${p.variantHint ?? '—'}\n` +
        `Details: ${p.fields.map((f) => `${f.label}=${f.value}`).join('; ')}` +
        (p.variants.length > 0
          ? `\nVariants: ${p.variants
              .map((v) => v.options.map((o) => `${o.name}=${o.value}`).join(', '))
              .join('; ')}`
          : '');

      const { candidates, isNew } = await findMatches({
        name: p.name,
        // A grouped product often has SKUs only on its variants; any of them finds the parent.
        sku: p.sku ?? p.variants.find((v) => v.sku)?.sku ?? null,
        brand: p.brand,
        variantHint: p.variantHint,
        searchTerms: p.searchTerms,
        descriptionForModel: described,
      });

      const top = candidates[0];
      const creating = isNew || !top;
      const prices = priceFields(p.prices, { isNew: creating });
      const fields: ProposedField[] = [...prices.fields, ...withoutPriceFields(p.fields)];
      const proposedVariants: ProposedVariant[] = p.variants.map((v) => ({
        sku: v.sku,
        price: catalogPrice(v.prices),
        retailPrice: v.prices.retail?.value ?? null,
        options: v.options,
        evidence: v.evidence,
      }));
      const payload: ActionPayload = {
        extracted: {
          name: p.name,
          sku: p.sku,
          brand: p.brand,
          price: catalogPrice(p.prices),
          description: p.description,
        },
        fields: creating ? fields : await pruneUnchangedFields(top.product_id, fields),
        variants: creating
          ? proposedVariants
          : await pruneExistingVariants(top.product_id, proposedVariants),
        sourceImage,
        notes: [...prices.notes, ...doc.notes],
      };

      const variants = payload.variants ?? [];
      const withVariants = variants.length > 0 ? ` and ${variants.length} variant(s)` : '';

      if (isNew || !top) {
        rows.push({
          kind: 'create_product',
          title: p.name,
          summary: `New product from ${doc.documentType}. ${fields.length} attribute(s)${withVariants} found.`,
          confidence: top?.score ?? 0,
          productId: null,
          variantId: null,
          payload,
          candidates,
        });
      } else {
        rows.push({
          kind: 'update_product',
          title: p.name,
          summary:
            payload.fields.length === 0 && variants.length === 0
              ? `Matched "${top.name}" — no new values to write.`
              : `Enrich "${top.name}" with ${payload.fields.length} field(s)${withVariants}.`,
          confidence: top.score,
          productId: top.product_id,
          variantId: top.variant_id ?? null,
          payload,
          candidates,
        });
      }
    }

    await insertActions(jobId, rows);
    await finishJob(jobId, 'done', `${doc.documentType}: ${rows.length} action(s) queued.`);
  } catch (err) {
    await finishJob(jobId, 'error', err instanceof Error ? err.message : String(err));
  }
}

/** Analyze a product image and queue an image-attachment action. */
export async function analyzeImageSource(
  jobId: string,
  buf: Buffer,
  filename: string,
  mime: string,
) {
  try {
    const stored = `${jobId}-${filename.replace(/[^\w.-]+/g, '_')}`;
    await putUpload(stored, buf, mime);

    const ocrText = await ocrImage(buf);
    const vision = await analyzeImage({
      base64: buf.toString('base64'),
      mime,
      filename,
      ocrText,
    });

    // A photographed page or handwritten note carries product data as text, not as a packshot,
    // so hand its transcription to the document pipeline instead of trying to match the image.
    if (vision.kind === 'document_photo') {
      const text = [vision.transcription, ocrText].filter(Boolean).join('\n\n');
      // The transcription is the useful artefact; the photo itself is not needed again.
      await deleteUpload(stored);
      await analyzeTextSource(jobId, text, filename, { filename });
      return;
    }

    if (vision.kind !== 'product_photo') {
      await deleteUpload(stored);
      await finishJob(jobId, 'done', `Not a product image — ${vision.caption}`);
      return;
    }

    const searchTerms = [...new Set([...vision.searchTerms, ...termsFromFilename(filename)])];
    const described =
      `Name: ${vision.productGuess}\nBrand: ${vision.brandGuess ?? '—'}\n` +
      `Filename: ${filename}\nVisible text: ${vision.visibleText || '—'}\n` +
      `Attributes: ${vision.attributes.map((a) => `${a.label}=${a.value}`).join('; ')}`;

    const { candidates, isNew } = await findMatches({
      name: vision.productGuess,
      sku: null,
      brand: vision.brandGuess,
      variantHint: vision.variantHint,
      searchTerms,
      descriptionForModel: described,
    });

    const top = candidates[0];
    const payload: ActionPayload = {
      extracted: {
        name: vision.productGuess,
        sku: null,
        brand: vision.brandGuess,
        price: null,
        description: vision.caption,
      },
      fields: vision.attributes.map((a) => ({
        name: a.label.toLowerCase().replace(/\s+/g, '_'),
        label: a.label,
        value: a.value,
        custom: true,
        evidence: 'Observed in image',
      })),
      image: { path: stored, filename, ocrText: ocrText || null, caption: vision.caption },
      notes: vision.visibleText ? [`Text read from image: ${vision.visibleText}`] : [],
    };

    if (isNew || !top) {
      await insertActions(jobId, [
        {
          kind: 'create_product',
          title: vision.productGuess || filename,
          summary: 'Image did not match any product in the channel — review or create a new product.',
          confidence: top?.score ?? 0,
          productId: null,
          variantId: null,
          payload,
          candidates,
        },
      ]);
      await finishJob(jobId, 'done', 'No confident match — queued for manual review.');
      return;
    }

    const isVariant = Boolean(top.variant_id);
    await insertActions(jobId, [
      {
        kind: isVariant ? 'set_variant_image' : 'add_product_image',
        title: vision.productGuess || filename,
        summary: isVariant
          ? `Set as variant image for "${top.name}" (${top.variant_label}).`
          : `Add as product image on "${top.name}".`,
        confidence: top.score,
        productId: top.product_id,
        variantId: top.variant_id ?? null,
        payload,
        candidates,
      },
    ]);
    await finishJob(jobId, 'done', `Matched "${top.name}".`);
  } catch (err) {
    await finishJob(jobId, 'error', err instanceof Error ? err.message : String(err));
  }
}

/** Entry point for an uploaded file: routes to the image or document pipeline. */
export async function analyzeUpload(jobId: string, buf: Buffer, filename: string, mime: string) {
  if (classify(filename, mime) === 'image') {
    await analyzeImageSource(jobId, buf, filename, mime);
  } else {
    const text = await extractText(buf, filename, mime).catch(() => '');
    await analyzeTextSource(jobId, text, filename);
  }
}
