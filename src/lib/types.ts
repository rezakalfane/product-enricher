/** A field the analyzer found in a document and wants to write to BigCommerce. */
export type ProposedField = {
  /** BigCommerce product field name, or a custom field name when `custom` is true. */
  name: string;
  label: string;
  value: string;
  custom: boolean;
  /** Where in the source document this came from — shown in the review modal. */
  evidence: string;
  /**
   * Excluded from the write by the reviewer. The value is kept so the field can be
   * switched back on without re-analyzing the source.
   */
  disabled?: boolean;
};

export type MatchCandidate = {
  product_id: number;
  name: string;
  sku: string;
  price: number;
  image: string | null;
  url: string | null;
  /** 0-1. How confident we are this catalog product is the one in the document. */
  score: number;
  reason: string;
  variant_id?: number;
  variant_label?: string;
};

export type ActionPayload = {
  /** Product as understood from the source material. */
  extracted: {
    name: string;
    sku: string | null;
    brand: string | null;
    price: number | null;
    description: string | null;
  };
  fields: ProposedField[];
  /** Populated for image actions. Path is relative to UPLOAD_DIR. */
  image?: { path: string; filename: string; ocrText: string | null; caption: string | null };
  /**
   * Name of the photographed document this came from. The photo itself is deleted as soon
   * as it has been transcribed, so only the filename is retained.
   */
  sourceImage?: { filename: string };
  /** Free-form analyzer notes surfaced in the modal. */
  notes: string[];
};
