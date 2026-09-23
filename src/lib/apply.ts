import { bc, type BCProduct } from './bigcommerce';
import { now, run, type QueueAction } from './db';
import { env } from './env';
import { enabledFields, NUMERIC_FIELDS, resolvesToCustomField } from './fields';
import { getUpload } from './storage';
import type { ActionPayload } from './types';

function splitFields(fields: ActionPayload['fields']) {
  const core: Record<string, string | number> = {};
  const custom: { name: string; value: string }[] = [];
  for (const f of enabledFields(fields)) {
    if (!resolvesToCustomField(f)) {
      const v = NUMERIC_FIELDS.has(f.name) ? Number(String(f.value).replace(/[^0-9.]/g, '')) : f.value;
      if (typeof v === 'number' && Number.isNaN(v)) continue;
      core[f.name] = v;
    } else {
      custom.push({ name: f.label || f.name, value: String(f.value).slice(0, 250) });
    }
  }
  return { core, custom };
}

async function writeCustomFields(productId: number, fields: { name: string; value: string }[]) {
  if (fields.length === 0) return;
  const existing = await bc<{ id: number; name: string }[]>(
    `/v3/catalog/products/${productId}/custom-fields`,
    { query: { limit: 250 } },
  ).catch(() => []);
  const byName = new Map(existing.map((f) => [f.name.toLowerCase(), f.id]));

  for (const f of fields) {
    const id = byName.get(f.name.toLowerCase());
    if (id) {
      await bc(`/v3/catalog/products/${productId}/custom-fields/${id}`, { method: 'PUT', body: f });
    } else {
      await bc(`/v3/catalog/products/${productId}/custom-fields`, { method: 'POST', body: f });
    }
  }
}

/** Push a stored upload to BigCommerce as multipart form data. */
async function uploadImage(productId: number, storedPath: string, filename: string, isThumbnail: boolean) {
  const buf = await getUpload(storedPath);
  const form = new FormData();
  form.append('image_file', new Blob([new Uint8Array(buf)]), filename);
  form.append('is_thumbnail', String(isThumbnail));

  const res = await fetch(
    `${env.apiUrl}/stores/${env.storeHash}/v3/catalog/products/${productId}/images`,
    { method: 'POST', headers: { 'X-Auth-Token': env.accessToken, Accept: 'application/json' }, body: form },
  );
  if (!res.ok) throw new Error(`Image upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { id: number; url_standard: string } };
  return json.data;
}

export type ApplyResult = { productId: number; message: string; url: string };

/** Push a queued action to BigCommerce. Throws on failure; caller records the error. */
export async function applyAction(action: QueueAction): Promise<ApplyResult> {
  const payload = JSON.parse(action.payload) as ActionPayload;
  const { core, custom } = splitFields(payload.fields);

  if (action.kind === 'create_product') {
    const created = await bc<BCProduct>('/v3/catalog/products', {
      method: 'POST',
      body: {
        name: payload.extracted.name,
        type: 'physical',
        weight: Number(core.weight ?? 0) || 0,
        price: payload.extracted.price ?? (Number(core.price ?? 0) || 0),
        sku: payload.extracted.sku ?? undefined,
        description: payload.extracted.description ?? undefined,
        ...core,
      },
    });
    await bc('/v3/catalog/products/channel-assignments', {
      method: 'PUT',
      body: [{ product_id: created.id, channel_id: env.channelId }],
    });
    await writeCustomFields(created.id, custom);
    if (payload.image) {
      await uploadImage(created.id, payload.image.path, payload.image.filename, true);
    }
    return {
      productId: created.id,
      message: `Created "${created.name}" and assigned it to ${env.channelName}.`,
      url: adminUrl(created.id),
    };
  }

  const productId = action.product_id;
  if (!productId) throw new Error('No product selected for this action.');

  if (action.kind === 'update_product') {
    if (Object.keys(core).length > 0) {
      await bc(`/v3/catalog/products/${productId}`, { method: 'PUT', body: core });
    }
    await writeCustomFields(productId, custom);
    const n = Object.keys(core).length + custom.length;
    return { productId, message: `Updated ${n} field(s).`, url: adminUrl(productId) };
  }

  if (!payload.image) throw new Error('This action has no image attached.');

  if (action.kind === 'add_product_image') {
    const existing = await bc<unknown[]>(`/v3/catalog/products/${productId}/images`).catch(() => []);
    const img = await uploadImage(productId, payload.image.path, payload.image.filename, existing.length === 0);
    return { productId, message: `Uploaded image #${img.id}.`, url: adminUrl(productId) };
  }

  // set_variant_image — upload to the product, then point the variant at the hosted URL.
  const img = await uploadImage(productId, payload.image.path, payload.image.filename, false);
  await bc(`/v3/catalog/products/${productId}/variants/${action.variant_id}`, {
    method: 'PUT',
    body: { image_url: img.url_standard },
  });
  return { productId, message: `Set variant image from #${img.id}.`, url: adminUrl(productId) };
}

function adminUrl(productId: number) {
  return `https://store-${env.storeHash}.mybigcommerce.com/manage/products/edit/${productId}`;
}

export async function markApplied(id: string, message: string) {
  await run(
    `UPDATE actions SET status = 'applied', error = NULL, summary = ?, updated_at = ? WHERE id = ?`,
    [message, now(), id],
  );
}

export async function markFailed(id: string, error: string) {
  await run(`UPDATE actions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, [
    error,
    now(),
    id,
  ]);
}
