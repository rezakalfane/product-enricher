import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { env } from './env';

const openai = createOpenAI({ apiKey: env.openaiApiKey });

const providerOptions = {
  openai: { reasoningEffort: env.reasoningEffort },
} as const;

const fieldSchema = z.object({
  name: z
    .string()
    .describe(
      'BigCommerce product field key (name, sku, description, price, weight, width, height, depth, ' +
        'mpn, gtin, brand, meta_description, search_keywords) or a custom field name.',
    ),
  label: z.string().describe('Human-readable label for the review UI.'),
  value: z.string(),
  custom: z.boolean().describe('True when this must be written as a BigCommerce custom field.'),
  evidence: z.string().describe('The sentence or line in the source that this value came from.'),
});

const priceSchema = z.object({
  value: z.number().describe('Plain number without currency symbol, e.g. 12.99.'),
  currency: z.string().nullable().describe('ISO code when stated or implied by a symbol, e.g. "GBP".'),
  label: z.string().describe('The label as written in the source, e.g. "Trade GBP", "Unit Cost", "RRP".'),
  evidence: z.string().describe('The line or table cell this price came from.'),
});

/**
 * Sources label prices every way imaginable, so the model sorts each one by meaning and
 * the analyzer maps the result onto BigCommerce's price fields.
 */
const pricesSchema = z.object({
  cost: priceSchema
    .nullable()
    .describe(
      'The trade price: trade price, unit cost, wholesale, net, buy price, cost price, dealer ' +
        'price.',
    ),
  retail: priceSchema
    .nullable()
    .describe('Recommended consumer price: RRP, MSRP, SRP, retail price, "sells at".'),
  unlabelled: priceSchema
    .nullable()
    .describe(
      'A price whose type the source does not state, e.g. a bare "GBP 12.99" or "Price". Use ' +
        'only when neither cost nor retail applies.',
    ),
});

export type ExtractedPrices = z.infer<typeof pricesSchema>;

const variantSchema = z.object({
  sku: z.string().nullable(),
  prices: pricesSchema.describe('Only prices specific to this variant; leave all null otherwise.'),
  options: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .describe('What sets this variant apart, e.g. [{ name: "Flavour", value: "Blue Razz" }].'),
  evidence: z.string().describe('The line in the source this variant came from.'),
});

const productSchema = z.object({
  name: z
    .string()
    .describe(
      'Product name as written in the source. For a product with variants, the shared line name ' +
        'without the flavour/strength/size, e.g. "Elux Legend Nic Salt 10ml".',
    ),
  sku: z.string().nullable(),
  brand: z.string().nullable(),
  prices: pricesSchema,
  description: z.string().nullable(),
  variantHint: z
    .string()
    .nullable()
    .describe('Any colour/size/material that identifies a specific variant, e.g. "Rose Quartz, 40oz".'),
  searchTerms: z
    .array(z.string())
    .describe('2-5 short keyword phrases to look this product up in a catalog. Brand and model first.'),
  fields: z
    .array(fieldSchema)
    .describe(
      'Every enrichable attribute found for this product except prices, which go in `prices`. ' +
        'For a product with variants, only attributes shared by all of them.',
    ),
  variants: z
    .array(variantSchema)
    .describe(
      'One entry per flavour, strength, size, or colour offered in this product line. Empty for a ' +
        'single standalone product.',
    ),
});

export type ExtractedProduct = z.infer<typeof productSchema>;

const documentSchema = z.object({
  documentType: z
    .string()
    .describe('e.g. "supplier spec sheet", "price list", "product email", "catalog page".'),
  products: z.array(productSchema),
  notes: z.array(z.string()).describe('Caveats a human reviewer should know, e.g. ambiguous units.'),
});

/** Parse product records out of arbitrary document text. */
export async function analyzeDocument(text: string, filename: string) {
  const { object } = await generateObject({
    model: openai(env.model),
    schema: documentSchema,
    providerOptions,
    system:
      'You extract structured product data from merchant documents so it can enrich an ecommerce ' +
      'catalog. Only report values that literally appear in the source — never invent specs, ' +
      'prices, or marketing copy. If the document describes several products, return one entry ' +
      'each — but group items that are the same product line differing only by flavour, ' +
      'nicotine strength, size, or colour (same brand, range, and format) into ONE product with ' +
      'a variant per flavour, rather than one product per flavour. Name options consistently ' +
      'across variants ("Flavour", "Nicotine Strength", "Size", "Colour"). Different ranges, ' +
      'formats (10ml vs 100ml shortfill, kit vs pods), or hardware are separate products. So "10 ' +
      'new flavours available in Kits and Pods" is two products (the kit and the pods), each with ' +
      'the 10 flavours as variants — a strength shared by all of them belongs in the name, not in ' +
      'an option. Only list variants that are named in the source; a count such as "40 flavours ' +
      'available" is not a list of variants. Classify every price by meaning, not by its label: ' +
      'trade/unit cost/wholesale is `cost`, RRP/MSRP is `retail`. In a trade document (price list, ' +
      'supplier spec sheet, anything mentioning trade, wholesale, case quantities, or ex-VAT) a ' +
      'price that only says "Price" or "GBP 12.99" is the trade cost unless the source says ' +
      'otherwise; use `unlabelled` only when you genuinely cannot tell.',
    prompt: `Source file: ${filename}\n\n---\n${text.slice(0, 120_000)}\n---`,
  });
  return object;
}

const imageSchema = z.object({
  kind: z
    .enum(['product_photo', 'document_photo', 'other'])
    .describe(
      'product_photo = the product itself is pictured. document_photo = a photo or scan of ' +
        'a page, note, label, spec sheet, or whiteboard whose text is the point. other = neither.',
    ),
  transcription: z
    .string()
    .describe(
      'For document_photo, a full plain-text transcription of everything written, preserving ' +
        'line order and handwriting as faithfully as you can. Empty string otherwise.',
    ),
  caption: z.string().describe('One sentence describing what is pictured.'),
  productGuess: z
    .string()
    .describe('Best guess at the product name, or "" if the image is not a product.'),
  brandGuess: z.string().nullable(),
  visibleText: z.string().describe('Any text legible in the image — labels, packaging, model numbers.'),
  attributes: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .describe('Visible attributes: colour, material, size marking, form factor.'),
  variantHint: z
    .string()
    .nullable()
    .describe('Colourway or size that would identify a specific variant rather than the base product.'),
  searchTerms: z.array(z.string()).describe('2-5 keyword phrases to find this product in a catalog.'),
});

export type ImageAnalysis = z.infer<typeof imageSchema>;

/** Identify a product from a packshot, using the filename and OCR text as extra signal. */
export async function analyzeImage(args: {
  base64: string;
  mime: string;
  filename: string;
  ocrText: string;
}) {
  const { object } = await generateObject({
    model: openai(env.visionModel),
    schema: imageSchema,
    providerOptions,
    system:
      'You triage images for an ecommerce catalog tool. First decide whether the image shows a ' +
      'product, or is a photo/scan of a document (including handwritten notes, labels, and spec ' +
      'sheets). For a document, transcribe it completely and accurately — that transcription is ' +
      'the only thing downstream sees. For a product, identify it from what you see plus the ' +
      'filename and OCR text. Never guess a brand that is not visible or implied by the ' +
      'filename — return null instead.',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              `Filename: ${args.filename}\n` +
              `OCR text: ${args.ocrText ? args.ocrText.slice(0, 2000) : '(none legible)'}\n\n` +
              'Identify the product pictured.',
          },
          { type: 'image', image: `data:${args.mime};base64,${args.base64}` },
        ],
      },
    ],
  });
  return object;
}

const rankSchema = z.object({
  matches: z.array(
    z.object({
      product_id: z.number(),
      score: z.number().min(0).max(1).describe('1 = certainly the same product, 0 = unrelated.'),
      reason: z.string().describe('One short sentence justifying the score.'),
    }),
  ),
  /** True when nothing in the catalog is the same product. */
  isNew: z.boolean(),
});

/** Ask the model which catalog candidates actually correspond to the extracted product. */
export async function rankMatches(args: {
  extracted: string;
  candidates: { id: number; name: string; sku: string; price: number }[];
}) {
  if (args.candidates.length === 0) return { matches: [], isNew: true };
  const { object } = await generateObject({
    model: openai(env.model),
    schema: rankSchema,
    providerOptions,
    system:
      'You decide whether a product described in a supplier document already exists in a catalog. ' +
      'Score conservatively: a different capacity, size, or colourway is a different product unless ' +
      'the catalog entry is clearly the parent of that variant. When the described product lists ' +
      'variants (flavours, strengths), the catalog product for the same line is a match even if it ' +
      'lacks some of those variants. Set isNew when no candidate scores above 0.6.',
    prompt:
      `Product from the document:\n${args.extracted}\n\n` +
      `Catalog candidates:\n${args.candidates
        .map((c) => `- id=${c.id} | ${c.name} | sku=${c.sku || '—'} | $${c.price}`)
        .join('\n')}`,
  });
  return object;
}
