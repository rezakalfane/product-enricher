import { bc, type BCProduct } from './bigcommerce';
import { productAdminUrl } from './client-types';
import { now, run, type QueueAction } from './db';
import { env } from './env';
import { enabledFields, NUMERIC_FIELDS, resolvesToCustomField } from './fields';
import { getUpload } from './storage';
import type { ActionPayload, ProposedVariant } from './types';

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

/** BigCommerce requires a SKU per variant; derive one from the base SKU or name when the source had none. */
function variantSku(base: string, v: ProposedVariant): string {
  if (v.sku) return v.sku;
  const suffix = v.options.map((o) => o.value).join('-');
  return `${base}-${suffix}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 255);
}

/** Only the prices the source gave for this variant; the rest inherit from the product. */
function variantPrices(v: ProposedVariant) {
  return {
    ...(v.price != null ? { price: v.price } : {}),
    ...(v.costPrice != null ? { cost_price: v.costPrice } : {}),
    ...(v.retailPrice != null ? { retail_price: v.retailPrice } : {}),
  };
}

type BCOption = {
  id: number;
  display_name: string;
  option_values: { id: number; label: string }[];
};

/**
 * Add variants to an existing product, creating option values as needed. A product with no
 * options yet gets the proposed options; otherwise a variant must use exactly the product's
 * options, since BigCommerce needs a value for every option on every variant.
 */
async function addVariants(productId: number, base: string, variants: ProposedVariant[]) {
  const optionsPath = `/v3/catalog/products/${productId}/options`;
  const options = await bc<BCOption[]>(optionsPath, { query: { limit: 250 } });
  const hadOptions = options.length > 0;
  const find = (name: string) =>
    options.find((o) => o.display_name.trim().toLowerCase() === name.trim().toLowerCase());

  let added = 0;
  const skipped: string[] = [];
  for (const v of variants) {
    const label = v.options.map((o) => o.value).join(' / ');
    const fits = hadOptions
      ? v.options.length === options.length && v.options.every((o) => find(o.name))
      : v.options.length > 0;
    if (!fits) {
      skipped.push(label);
      continue;
    }

    const optionValues: { id: number; option_id: number }[] = [];
    for (const o of v.options) {
      let option = find(o.name);
      if (!option) {
        option = await bc<BCOption>(optionsPath, {
          method: 'POST',
          body: {
            display_name: o.name,
            type: 'dropdown',
            option_values: [{ label: o.value, sort_order: 0 }],
          },
        });
        options.push(option);
      }
      let value = option.option_values.find(
        (x) => x.label.trim().toLowerCase() === o.value.trim().toLowerCase(),
      );
      if (!value) {
        value = await bc<{ id: number; label: string }>(`${optionsPath}/${option.id}/values`, {
          method: 'POST',
          body: { label: o.value, sort_order: option.option_values.length },
        });
        option.option_values.push(value);
      }
      optionValues.push({ id: value.id, option_id: option.id });
    }

    await bc(`/v3/catalog/products/${productId}/variants`, {
      method: 'POST',
      body: {
        sku: variantSku(base, v),
        ...variantPrices(v),
        option_values: optionValues,
      },
    });
    added++;
  }
  return { added, skipped };
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
  const variants = enabledFields(payload.variants ?? []);

  if (action.kind === 'create_product') {
    const base = payload.extracted.sku ?? payload.extracted.name;
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
        // Inline variants let BigCommerce create the options and values in the same call.
        ...(variants.length > 0
          ? {
              variants: variants.map((v) => ({
                sku: variantSku(base, v),
                ...variantPrices(v),
                option_values: v.options.map((o) => ({
                  option_display_name: o.name,
                  label: o.value,
                })),
              })),
            }
          : {}),
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
      message:
        `Created "${created.name}"` +
        (variants.length > 0 ? ` with ${variants.length} variant(s)` : '') +
        ` and assigned it to ${env.channelName}.`,
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
    const parts = [`Updated ${n} field(s)`];
    if (variants.length > 0) {
      const base = payload.extracted.sku ?? payload.extracted.name;
      const { added, skipped } = await addVariants(productId, base, variants);
      parts.push(`added ${added} variant(s)`);
      if (skipped.length > 0) {
        parts.push(`skipped ${skipped.join(', ')} (options don't match the product's)`);
      }
    }
    return { productId, message: `${parts.join(', ')}.`, url: adminUrl(productId) };
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
  return productAdminUrl(env.storeHash, productId);
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
