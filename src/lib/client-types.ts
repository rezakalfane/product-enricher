import type { ActionKind, ActionStatus } from './db';
import type { ActionPayload, MatchCandidate } from './types';

/** An action as returned by the queue API, with its JSON columns already parsed. */
export type ActionView = {
  id: string;
  job_id: string;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  summary: string;
  confidence: number;
  product_id: number | null;
  variant_id: number | null;
  payload: ActionPayload;
  candidates: MatchCandidate[];
  error: string | null;
  created_at: string;
  updated_at: string;
  filename: string;
  source_type: 'file' | 'text';
  mime: string;
};

export type StoreInfo = {
  connected: boolean;
  storeName?: string;
  storeHash?: string;
  channelName: string;
  channelId?: number;
  productCount?: number;
  model: string;
  error?: string;
};

export const KIND_LABEL: Record<ActionKind, string> = {
  create_product: 'Create product',
  update_product: 'Update product',
  add_product_image: 'Add product image',
  set_variant_image: 'Set variant image',
};

export const STATUS_LABEL: Record<ActionStatus, string> = {
  pending: 'Needs review',
  approved: 'Approved',
  applied: 'Applied',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

/** A source with no reviewable action of its own — in flight, failed, or empty. */
export type JobView = {
  id: string;
  filename: string;
  status: 'analyzing' | 'done' | 'error';
  note: string | null;
  created_at: string;
  actionCount: number;
};
