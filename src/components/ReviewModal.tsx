'use client';

import { clsx } from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionView } from '@/lib/client-types';
import { KIND_LABEL, productAdminUrl } from '@/lib/client-types';
import type { ActionKind } from '@/lib/db';
import { enabledFields, resolvesToCustomField } from '@/lib/fields';
import type { MatchCandidate, ProposedField, ProposedVariant } from '@/lib/types';
import { Badge, Button, ConfidenceMeter, Spinner } from './ui';
import {
  AlertIcon,
  BoxIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LinkIcon,
  PlusIcon,
  SearchIcon,
  SparkIcon,
  XIcon,
} from './icons';

type SearchHit = {
  product_id: number;
  name: string;
  sku: string;
  price: number;
  image: string | null;
  variants: { id: number; label: string }[];
};

export function ReviewModal({
  action,
  animateIn = true,
  storeHash,
  onClose,
  onChanged,
  position,
  onNext,
  onPrev,
}: {
  action: ActionView;
  /** Play the opening animation. Off when stepping between items. */
  animateIn?: boolean;
  /** Enables the Control Panel link on product cards. */
  storeHash?: string;
  onClose: () => void;
  onChanged: () => void;
  /** Set when reviewing a batch from one analysis, e.g. 2 of 4. */
  position?: { index: number; total: number };
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const [fields, setFields] = useState<ProposedField[]>(action.payload.fields);
  const [variants, setVariants] = useState<ProposedVariant[]>(action.payload.variants ?? []);
  const [productId, setProductId] = useState<number | null>(action.product_id);
  const [variantId, setVariantId] = useState<number | null>(action.variant_id);
  const [kind, setKind] = useState<ActionKind>(action.kind);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<'apply' | 'save' | 'cancel' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; url?: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const active = enabledFields(fields);
  const activeVariants = enabledFields(variants);
  const hasImage = Boolean(action.payload.image);
  const sourceImage = action.payload.image ?? null;
  const transcribedFrom = !action.payload.image ? (action.payload.sourceImage ?? null) : null;
  const isApplied = action.status === 'applied';

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      // Arrow keys belong to the field while typing.
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onPrev]);

  // Debounced catalog search for re-pointing the action at a different product.
  useEffect(() => {
    if (query.trim().length < 2) {
      const clear = setTimeout(() => setHits([]), 0);
      return () => clearTimeout(clear);
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setHits(json.products ?? []);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const selected = useMemo(
    () =>
      action.candidates.find((c) => c.product_id === productId) ??
      hits.find((h) => h.product_id === productId) ??
      null,
    [action.candidates, hits, productId],
  );

  const variantOptions = useMemo(
    () => hits.find((h) => h.product_id === productId)?.variants ?? [],
    [hits, productId],
  );

  async function patch(body: Record<string, unknown>, which: 'save' | 'cancel') {
    setBusy(which);
    try {
      await fetch(`/api/queue/${action.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy('apply');
    setResult(null);
    try {
      // Persist the reviewer's edits first so the server applies exactly what's on screen.
      await fetch(`/api/queue/${action.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId, variant_id: variantId, kind, fields, variants }),
      });
      const res = await fetch(`/api/queue/${action.id}/apply`, { method: 'POST' });
      const json = await res.json();
      setResult(
        res.ok
          ? { ok: true, message: json.message, url: json.url }
          : { ok: false, message: json.error ?? 'Apply failed.' },
      );
      onChanged();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Apply failed.' });
    } finally {
      setBusy(null);
    }
  }

  const canApply =
    !isApplied && (kind === 'create_product' || productId !== null) &&
    (hasImage || active.length > 0 || activeVariants.length > 0 || kind === 'create_product');

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-bc-ink/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Review: ${action.title}`}
        tabIndex={-1}
        className={clsx(
          // Fixed size so stepping between items doesn't resize the window; the body scrolls instead.
          'flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:h-[min(88dvh,860px)] sm:rounded-2xl',
          animateIn && 'animate-scale-in',
        )}
      >
        {/* Header */}
        <header className="flex items-start gap-4 border-b border-bc-line px-6 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={kind === 'create_product' ? 'teal' : 'blue'}>{KIND_LABEL[kind]}</Badge>
              {action.candidates.length > 0 ? (
                <ConfidenceMeter value={action.confidence} />
              ) : (
                <Badge tone="neutral">no catalog match</Badge>
              )}
              {action.filename && (
                <span className="truncate text-xs text-bc-muted">from {action.filename}</span>
              )}
            </div>
            <h2 className="mt-1.5 truncate text-lg font-semibold tracking-tight text-bc-ink">
              {action.title}
            </h2>
          </div>
          {position && (
            <div className="flex shrink-0 items-center gap-1">
              <NavButton label="Previous" shortcut="←" keys="ArrowLeft" onClick={onPrev}>
                <ChevronLeftIcon className="size-4.5" />
              </NavButton>
              <span className="tnum min-w-12 text-center text-[11px] font-semibold text-bc-muted">
                {position.index} of {position.total}
              </span>
              <NavButton label="Next" shortcut="→" keys="ArrowRight" onClick={onNext}>
                <ChevronRightIcon className="size-4.5" />
              </NavButton>
              <span className="mx-1 h-5 w-px bg-bc-line" aria-hidden />
            </div>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-bc-muted transition hover:bg-bc-surface hover:text-bc-ink"
          >
            <XIcon className="size-4.5" />
          </button>
        </header>

        {/* Body */}
        <div className="scroll-slim grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto md:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left: what we found */}
          <div className="flex flex-col gap-6 border-bc-line p-6 md:border-r">
            {transcribedFrom && (
              <section>
                <SectionTitle>Photographed source</SectionTitle>
                <p className="mt-2 rounded-lg bg-bc-surface px-3 py-2.5 text-[13px] text-bc-muted">
                  Transcribed from{' '}
                  <span className="font-medium text-bc-slate">{transcribedFrom.filename}</span>. The
                  photo was deleted once it had been read — the text below is what was kept.
                </p>
              </section>
            )}

            {sourceImage && (
              <section>
                <SectionTitle>Source image</SectionTitle>
                <div className="mt-2 flex gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/${encodeURIComponent(sourceImage.path)}`}
                    alt={action.payload.image?.caption ?? action.title}
                    className="size-32 shrink-0 rounded-xl border border-bc-line bg-bc-surface object-contain"
                  />
                  <div className="min-w-0 space-y-1.5 text-[13px]">
                    {action.payload.image?.caption && (
                      <p className="text-bc-slate">{action.payload.image.caption}</p>
                    )}
                    <p className="text-bc-muted">
                      <span className="font-medium text-bc-slate">File:</span> {sourceImage.filename}
                    </p>
                    {action.payload.image?.ocrText && (
                      <p className="line-clamp-3 text-bc-muted">
                        <span className="font-medium text-bc-slate">OCR:</span>{' '}
                        {action.payload.image.ocrText}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section>
              <SectionTitle>Extracted from source</SectionTitle>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-3">
                {(
                  [
                    ['Name', action.payload.extracted.name],
                    ['SKU', action.payload.extracted.sku],
                    ['Brand', action.payload.extracted.brand],
                    ['Price', action.payload.extracted.price?.toString()],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-bc-muted">
                      {label}
                    </dt>
                    <dd className="mt-0.5 truncate font-medium text-bc-ink" title={value ?? ''}>
                      {value || <span className="text-bc-muted/60">—</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <div className="flex items-center justify-between">
                <SectionTitle>
                  Proposed fields{' '}
                  <span className="tnum font-normal text-bc-muted">
                    ({active.length} of {fields.length})
                  </span>
                </SectionTitle>
                {fields.length > 0 && !isApplied && (
                  <button
                    onClick={() => {
                      const turnOff = active.length > 0;
                      setFields((prev) => prev.map((f) => ({ ...f, disabled: turnOff })));
                    }}
                    className="text-xs font-medium text-bc-muted hover:text-bc-blue-600"
                  >
                    {active.length > 0 ? 'Disable all' : 'Enable all'}
                  </button>
                )}
              </div>

              {fields.length === 0 && variants.length > 0 ? (
                <p className="mt-2 rounded-lg bg-bc-surface px-3 py-2.5 text-[13px] text-bc-muted">
                  No product-level values to write — see the variants below.
                </p>
              ) : fields.length === 0 ? (
                <p className="mt-2 rounded-lg bg-bc-surface px-3 py-2.5 text-[13px] text-bc-muted">
                  Nothing new to write — every value in the source already matches the catalog.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-bc-line overflow-hidden rounded-xl border border-bc-line">
                  {fields.map((f, i) => {
                    const off = Boolean(f.disabled);
                    const toggle = () =>
                      setFields((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, disabled: !x.disabled } : x)),
                      );
                    return (
                      <li
                        key={`${f.name}-${i}`}
                        className={clsx(
                          'group p-3 transition-colors',
                          off ? 'bg-bc-surface/70' : 'bg-white hover:bg-bc-blue-50/30',
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={clsx('min-w-0 flex-1', off && 'opacity-55')}>
                            <div className="flex items-center gap-2">
                              <span
                                className={clsx(
                                  'text-[13px] font-semibold text-bc-ink',
                                  off && 'line-through decoration-bc-muted/60',
                                )}
                              >
                                {f.label}
                              </span>
                              <Badge tone={off ? 'neutral' : resolvesToCustomField(f) ? 'neutral' : 'blue'}>
                                {resolvesToCustomField(f) ? 'custom field' : f.name}
                              </Badge>
                              {off && <Badge tone="neutral">won’t be written</Badge>}
                            </div>
                            <input
                              value={f.value}
                              disabled={isApplied || off}
                              onChange={(e) =>
                                setFields((prev) =>
                                  prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                                )
                              }
                              className={clsx(
                                'mt-1.5 w-full rounded-md border border-transparent px-2 py-1.5 text-[13px] transition',
                                'focus:border-bc-blue-400 focus:bg-white focus:outline-none',
                                off
                                  ? 'bg-transparent text-bc-muted line-through'
                                  : 'bg-bc-surface text-bc-slate',
                              )}
                            />
                            {f.evidence && (
                              <p className="mt-1.5 border-l-2 border-bc-line pl-2 text-[11px] italic leading-snug text-bc-muted">
                                “{f.evidence}”
                              </p>
                            )}
                          </div>
                          {!isApplied && (
                            <button
                              onClick={toggle}
                              aria-pressed={off}
                              title={off ? 'Include this field again' : 'Exclude from this update'}
                              aria-label={
                                off ? `Re-enable ${f.label}` : `Exclude ${f.label} from this update`
                              }
                              className={clsx(
                                'mt-0.5 grid size-6 shrink-0 place-items-center rounded transition',
                                off
                                  ? 'text-bc-blue-600 opacity-100 hover:bg-bc-blue-50'
                                  : 'text-bc-muted opacity-0 hover:bg-red-50 hover:text-bc-red group-hover:opacity-100 focus-visible:opacity-100',
                              )}
                            >
                              {off ? <PlusIcon className="size-4" /> : <XIcon className="size-3.5" />}
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {variants.length > 0 && (
              <section>
                <div className="flex items-center justify-between">
                  <SectionTitle>
                    Variants{' '}
                    <span className="tnum font-normal text-bc-muted">
                      ({activeVariants.length} of {variants.length})
                    </span>
                  </SectionTitle>
                  {!isApplied && (
                    <button
                      onClick={() => {
                        const turnOff = activeVariants.length > 0;
                        setVariants((prev) => prev.map((v) => ({ ...v, disabled: turnOff })));
                      }}
                      className="text-xs font-medium text-bc-muted hover:text-bc-blue-600"
                    >
                      {activeVariants.length > 0 ? 'Disable all' : 'Enable all'}
                    </button>
                  )}
                </div>
                <ul className="mt-2 divide-y divide-bc-line overflow-hidden rounded-xl border border-bc-line">
                  {variants.map((v, i) => {
                    const off = Boolean(v.disabled);
                    const label = v.options.map((o) => o.value).join(' / ');
                    return (
                      <li
                        key={`${label}-${i}`}
                        className={clsx(
                          'group flex items-center gap-3 px-3 py-2 transition-colors',
                          off ? 'bg-bc-surface/70' : 'bg-white hover:bg-bc-blue-50/30',
                        )}
                      >
                        <div className={clsx('min-w-0 flex-1', off && 'opacity-55')}>
                          <p
                            className={clsx(
                              'truncate text-[13px] font-semibold text-bc-ink',
                              off && 'line-through decoration-bc-muted/60',
                            )}
                            title={v.evidence}
                          >
                            {label}
                          </p>
                          <p className="tnum truncate text-[11px] text-bc-muted">
                            {v.options.map((o) => o.name).join(' / ')}
                            {v.sku && ` · ${v.sku}`}
                            {v.price != null && ` · Price ${v.price}`}
                            {v.costPrice != null && ` · Cost ${v.costPrice}`}
                            {v.retailPrice != null && ` · RRP ${v.retailPrice}`}
                          </p>
                        </div>
                        {off && <Badge tone="neutral">won’t be created</Badge>}
                        {!isApplied && (
                          <button
                            onClick={() =>
                              setVariants((prev) =>
                                prev.map((x, j) => (j === i ? { ...x, disabled: !x.disabled } : x)),
                              )
                            }
                            aria-pressed={off}
                            title={off ? 'Include this variant again' : 'Exclude this variant'}
                            aria-label={off ? `Re-enable ${label}` : `Exclude ${label}`}
                            className={clsx(
                              'grid size-6 shrink-0 place-items-center rounded transition',
                              off
                                ? 'text-bc-blue-600 opacity-100 hover:bg-bc-blue-50'
                                : 'text-bc-muted opacity-0 hover:bg-red-50 hover:text-bc-red group-hover:opacity-100 focus-visible:opacity-100',
                            )}
                          >
                            {off ? <PlusIcon className="size-4" /> : <XIcon className="size-3.5" />}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {action.payload.notes.length > 0 && (
              <section>
                <SectionTitle>Analyzer notes</SectionTitle>
                <ul className="mt-2 space-y-1.5">
                  {action.payload.notes.map((n, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-bc-muted">
                      <SparkIcon className="mt-0.5 size-3.5 shrink-0 text-bc-blue-400" />
                      {n}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Right: destination */}
          <div className="flex flex-col gap-4 bg-bc-surface/50 p-6">
            <div>
              <SectionTitle>Destination</SectionTitle>
              <p className="mt-1 text-xs leading-relaxed text-bc-muted">
                Pick the catalog product this applies to, or create a new one.
              </p>
            </div>

            <button
              onClick={() => {
                setKind('create_product');
                setProductId(null);
                setVariantId(null);
              }}
              disabled={isApplied}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl border p-3 text-left transition disabled:opacity-60',
                kind === 'create_product'
                  ? 'border-bc-teal bg-teal-50/60 ring-1 ring-bc-teal/30'
                  : 'border-bc-line bg-white hover:border-bc-blue-300',
              )}
            >
              <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-teal-100 text-bc-teal">
                <BoxIcon className="size-4" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-bc-ink">Create as a new product</p>
                <p className="text-[11px] text-bc-muted">Assigned to the configured channel</p>
              </div>
            </button>

            {action.candidates.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-bc-muted">
                  Suggested matches
                </p>
                <ul className="space-y-2">
                  {action.candidates.map((c) => (
                    <CandidateCard
                      key={c.product_id}
                      candidate={c}
                      adminUrl={storeHash ? productAdminUrl(storeHash, c.product_id) : undefined}
                      selected={kind !== 'create_product' && productId === c.product_id}
                      disabled={isApplied}
                      onSelect={() => {
                        setProductId(c.product_id);
                        setVariantId(c.variant_id ?? null);
                        setKind(
                          hasImage
                            ? c.variant_id
                              ? 'set_variant_image'
                              : 'add_product_image'
                            : 'update_product',
                        );
                      }}
                    />
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-bc-muted">
                Search the catalog
              </p>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-bc-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name or SKU…"
                  disabled={isApplied}
                  className="w-full rounded-lg border border-bc-line bg-white py-2 pl-8 pr-8 text-[13px] transition focus:border-bc-blue-400 focus:outline-none"
                />
                {searching && (
                  <Spinner className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-bc-blue-500" />
                )}
              </div>
              {hits.length > 0 && (
                <ul className="scroll-slim mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                  {hits.map((h) => (
                    <CandidateCard
                      key={h.product_id}
                      candidate={{
                        product_id: h.product_id,
                        name: h.name,
                        sku: h.sku,
                        price: h.price,
                        image: h.image,
                        url: null,
                        score: 0,
                        reason: '',
                      }}
                      selected={kind !== 'create_product' && productId === h.product_id}
                      disabled={isApplied}
                      hideScore
                      adminUrl={storeHash ? productAdminUrl(storeHash, h.product_id) : undefined}
                      onSelect={() => {
                        setProductId(h.product_id);
                        setVariantId(null);
                        setKind(hasImage ? 'add_product_image' : 'update_product');
                      }}
                    />
                  ))}
                </ul>
              )}
            </div>

            {hasImage && productId && variantOptions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-bc-muted">
                  Attach to a variant
                </p>
                <select
                  value={variantId ?? ''}
                  disabled={isApplied}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null;
                    setVariantId(v);
                    setKind(v ? 'set_variant_image' : 'add_product_image');
                  }}
                  className="w-full rounded-lg border border-bc-line bg-white px-2.5 py-2 text-[13px] focus:border-bc-blue-400 focus:outline-none"
                >
                  <option value="">Whole product (gallery image)</option>
                  {variantOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selected && kind !== 'create_product' && (
              <div className="rounded-xl border border-bc-blue-200 bg-bc-blue-50/70 p-3 text-[12px] leading-relaxed text-bc-blue-700">
                <span className="font-semibold">Will apply to</span> #{selected.product_id} ·{' '}
                {selected.name}
                {variantId && kind === 'set_variant_image' && <> · variant #{variantId}</>}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-bc-line bg-white px-6 py-3.5">
          {result && (
            <p
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px]',
                result.ok
                  ? 'bg-emerald-50 text-bc-green ring-1 ring-inset ring-emerald-100'
                  : 'bg-red-50 text-bc-red ring-1 ring-inset ring-red-100',
              )}
            >
              {result.ok ? (
                <CheckIcon className="size-4 shrink-0" />
              ) : (
                <AlertIcon className="size-4 shrink-0" />
              )}
              <span className="truncate">{result.message}</span>
              {result.url && (
                <a
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 font-semibold underline-offset-2 hover:underline"
                >
                  Open in BigCommerce <LinkIcon className="size-3.5" />
                </a>
              )}
            </p>
          )}
          {!result && <div className="flex-1" />}

          {!isApplied && (
            <>
              <Button
                variant="ghost"
                loading={busy === 'cancel'}
                onClick={() =>
                  patch({ status: 'cancelled' }, 'cancel').then(() => (onNext ? onNext() : onClose()))
                }
              >
                Cancel action
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'save'}
                onClick={() =>
                  patch({ product_id: productId, variant_id: variantId, kind, fields, variants }, 'save')
                }
              >
                Save changes
              </Button>
              <Button variant="primary" loading={busy === 'apply'} disabled={!canApply} onClick={apply}>
                <CheckIcon className="size-4" />
                Apply to BigCommerce
              </Button>
            </>
          )}
          {isApplied && (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
          {onNext && (
            <Button variant={result?.ok || isApplied ? 'primary' : 'secondary'} onClick={onNext}>
              Next
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function NavButton({
  label,
  shortcut,
  keys,
  onClick,
  children,
}: {
  label: string;
  shortcut: string;
  keys: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      title={`${label} (${shortcut})`}
      aria-label={label}
      aria-keyshortcuts={keys}
      className="grid size-8 place-items-center rounded-lg text-bc-muted transition hover:bg-bc-surface hover:text-bc-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold uppercase tracking-wider text-bc-slate">{children}</h3>;
}

function CandidateCard({
  candidate,
  selected,
  disabled,
  hideScore,
  adminUrl,
  onSelect,
}: {
  candidate: MatchCandidate;
  selected: boolean;
  disabled?: boolean;
  hideScore?: boolean;
  adminUrl?: string;
  onSelect: () => void;
}) {
  return (
    <li className="relative">
      <button
        onClick={onSelect}
        disabled={disabled}
        className={clsx(
          'flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition disabled:opacity-60',
          adminUrl && 'pr-9',
          selected
            ? 'border-bc-blue-500 bg-white ring-1 ring-bc-blue-400'
            : 'border-bc-line bg-white hover:border-bc-blue-300',
        )}
      >
        {candidate.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.image}
            alt=""
            className="size-11 shrink-0 rounded-lg border border-bc-line bg-bc-surface object-contain"
          />
        ) : (
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-bc-surface text-bc-muted">
            <BoxIcon className="size-4.5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-bc-ink">{candidate.name}</p>
          <p className="tnum truncate text-[11px] text-bc-muted">
            #{candidate.product_id}
            {candidate.sku && ` · ${candidate.sku}`}
            {candidate.price > 0 && ` · $${candidate.price}`}
          </p>
          {candidate.variant_label && (
            <Badge tone="teal" className="mt-1">
              {candidate.variant_label}
            </Badge>
          )}
          {!hideScore && (
            <div className="mt-1.5">
              <ConfidenceMeter value={candidate.score} />
            </div>
          )}
          {candidate.reason && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-bc-muted">{candidate.reason}</p>
          )}
        </div>
        {selected && <CheckIcon className="mt-1 size-4 shrink-0 text-bc-blue-500" />}
      </button>
      {/* A sibling of the card button, not a child: links can't nest inside buttons. */}
      {adminUrl && (
        <a
          href={adminUrl}
          target="_blank"
          rel="noreferrer"
          title="Open in BigCommerce"
          aria-label={`Open ${candidate.name} in BigCommerce`}
          className="absolute bottom-2 right-2 grid size-6 place-items-center rounded-md border border-bc-line bg-white text-bc-slate transition hover:border-bc-blue-300 hover:text-bc-blue-500"
        >
          <LinkIcon className="size-3.5" />
        </a>
      )}
    </li>
  );
}
