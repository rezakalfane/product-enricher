/** Product fields the apply step writes directly. Anything else becomes a custom field. */
export const WRITABLE_FIELDS = new Set([
  'name', 'sku', 'description', 'price', 'cost_price', 'retail_price', 'weight', 'width',
  'height', 'depth', 'mpn', 'gtin', 'upc', 'meta_description', 'search_keywords',
  'warranty', 'condition', 'availability_description', 'page_title',
]);

export const NUMERIC_FIELDS = new Set([
  'price', 'cost_price', 'retail_price', 'weight', 'width', 'height', 'depth',
]);

/**
 * Where a proposed field will actually land. The model's `custom` flag is a hint —
 * anything outside WRITABLE_FIELDS is written as a custom field regardless, so the
 * review UI and the apply step must agree on this one rule.
 */
export function resolvesToCustomField(field: { name: string; custom: boolean }): boolean {
  return field.custom || !WRITABLE_FIELDS.has(field.name);
}

/** Fields that will actually be written — disabled ones are kept for the UI only. */
export function enabledFields<T extends { disabled?: boolean }>(fields: T[]): T[] {
  return fields.filter((f) => !f.disabled);
}
