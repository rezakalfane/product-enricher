'use client';

import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionView, JobView, StoreInfo } from '@/lib/client-types';
import { KIND_LABEL, STATUS_LABEL } from '@/lib/client-types';
import type { ActionStatus } from '@/lib/db';
import { enabledFields } from '@/lib/fields';
import { IntakePanel } from './IntakePanel';
import { ReviewModal } from './ReviewModal';
import { Badge, Button, ConfidenceMeter, EmptyState, Spinner } from './ui';
import { AlertIcon, BoxIcon, CheckIcon, DocIcon, ImageIcon, SparkIcon, TextIcon, TrashIcon } from './icons';

const FILTERS: { key: ActionStatus | 'all'; label: string }[] = [
  { key: 'pending', label: 'Needs review' },
  { key: 'applied', label: 'Applied' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const STATUS_TONE: Record<ActionStatus, 'neutral' | 'blue' | 'green' | 'amber' | 'red'> = {
  pending: 'amber',
  approved: 'blue',
  applied: 'green',
  cancelled: 'neutral',
  failed: 'red',
};

export function Workspace() {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [actions, setActions] = useState<ActionView[]>([]);
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<ActionStatus | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openAction, setOpenAction] = useState<ActionView | null>(null);
  /** Action ids from the most recent analysis, so the reviewer can step through them. */
  const [reviewQueue, setReviewQueue] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/queue?status=${filter}`);
      const json = await res.json();
      setActions(json.actions ?? []);
      setJobs(json.jobs ?? []);
      setCounts(json.counts ?? {});
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    let live = true;
    // Refetch whenever the filter changes; `live` drops the response if it changed again first.
    void (async () => {
      const res = await fetch(`/api/queue?status=${filter}`);
      const json = await res.json();
      if (!live) return;
      setActions(json.actions ?? []);
      setJobs(json.jobs ?? []);
      setCounts(json.counts ?? {});
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [filter]);

  useEffect(() => {
    void fetch('/api/store')
      .then((r) => r.json())
      .then(setStore)
      .catch(() => setStore(null));
  }, []);

  useEffect(() => {
    if (!openId) return;
    let live = true;
    void (async () => {
      const res = await fetch(`/api/queue/${openId}`);
      if (!res.ok) return;
      const json = await res.json();
      if (live) setOpenAction(json);
    })();
    return () => {
      live = false;
    };
  }, [openId]);

  // Read by handleAnalyzed, which runs from a batch's polling loop long after it was created.
  const openIdRef = useRef(openId);
  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  /** Refresh the list, then open the first action the analysis produced. */
  const handleAnalyzed = useCallback(
    (actionIds: string[]) => {
      void load();
      if (actionIds.length === 0) return;
      // Several batches can finish in turn; don't pull the user out of a review in progress.
      if (openIdRef.current) return;
      setFilter('pending');
      setReviewQueue(actionIds);
      setOpenId(actionIds[0]);
    },
    [load],
  );

  const analyzing = jobs.filter((j) => j.status === 'analyzing').length;

  useEffect(() => {
    if (analyzing === 0) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [analyzing, load]);

  // Sources can also arrive from a channel (/api/ingest), so check in slowly when idle too.
  useEffect(() => {
    if (analyzing > 0) return;
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => clearInterval(t);
  }, [analyzing, load]);

  const queueIndex = openId ? reviewQueue.indexOf(openId) : -1;
  const hasNext = queueIndex >= 0 && queueIndex < reviewQueue.length - 1;

  const closeModal = useCallback(() => {
    setOpenId(null);
    setReviewQueue([]);
  }, []);

  const pending = counts.pending ?? 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px] flex-col gap-6 px-5 py-6 lg:px-8">
      <TopBar store={store} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)]">
        <IntakePanel onDone={handleAnalyzed} onPartial={load} />
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-bc-line bg-white shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-bc-line px-5 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-bc-ink">Action queue</h2>
            {pending > 0 && <Badge tone="amber">{pending} awaiting review</Badge>}
            {analyzing > 0 && (
              <Badge tone="blue">
                <Spinner className="size-3" />
                {analyzing} analyzing
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg bg-bc-surface p-0.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={clsx(
                    'rounded-[7px] px-2.5 py-1.5 text-[12px] font-medium transition',
                    filter === f.key
                      ? 'bg-white text-bc-ink shadow-xs'
                      : 'text-bc-muted hover:text-bc-ink',
                  )}
                >
                  {f.label}
                  {counts[f.key] ? (
                    <span className="tnum ml-1.5 text-bc-muted">{counts[f.key]}</span>
                  ) : null}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              title="Clear the whole queue"
              onClick={async () => {
                if (!confirm('Clear every queued action? This does not undo anything already applied to BigCommerce.')) return;
                await fetch('/api/queue', { method: 'DELETE' });
                void load();
              }}
            >
              <TrashIcon className="size-4" />
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="grid place-items-center py-20">
            <Spinner className="size-6 text-bc-blue-500" />
          </div>
        ) : actions.length === 0 && jobs.length === 0 ? (
          <EmptyState
            icon={<SparkIcon className="size-6" />}
            title={filter === 'pending' ? 'Nothing waiting on you' : 'No actions here'}
            body="Upload a spec sheet, price list, or product photo above and the analyzer will propose catalog changes for you to review."
          />
        ) : (
          <ul className="divide-y divide-bc-line">
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} />
            ))}
            {actions.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setOpenId(a.id)}
                  className="animate-fade-up flex w-full items-center gap-4 px-5 py-3.5 text-left transition hover:bg-bc-blue-50/40"
                >
                  <SourceThumb action={a} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-bc-ink">{a.title}</p>
                      <Badge tone={a.kind === 'create_product' ? 'teal' : 'blue'}>
                        {KIND_LABEL[a.kind]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-bc-muted">{a.summary}</p>
                    <p className="mt-0.5 truncate text-[11px] text-bc-muted/80">
                      {a.filename}
                      {a.product_id ? ` · product #${a.product_id}` : ''}
                      {a.payload.fields.length
                        ? ` · ${enabledFields(a.payload.fields).length} of ${a.payload.fields.length} field(s)`
                        : ''}
                    </p>
                  </div>
                  <div className="hidden w-32 shrink-0 sm:block">
                    {a.candidates.length > 0 ? (
                      <ConfidenceMeter value={a.confidence} />
                    ) : (
                      <span className="text-[11px] font-medium text-bc-muted">no catalog match</span>
                    )}
                  </div>
                  <Badge tone={STATUS_TONE[a.status]} className="shrink-0">
                    {a.status === 'applied' && <CheckIcon className="size-3" />}
                    {a.status === 'failed' && <AlertIcon className="size-3" />}
                    {STATUS_LABEL[a.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {openId && openAction?.id === openId && (
        <ReviewModal
          key={openAction.id}
          action={openAction}
          storeHash={store?.storeHash}
          onClose={closeModal}
          onChanged={load}
          position={
            reviewQueue.length > 1 && queueIndex >= 0
              ? { index: queueIndex + 1, total: reviewQueue.length }
              : undefined
          }
          onNext={hasNext ? () => setOpenId(reviewQueue[queueIndex + 1]) : undefined}
        />
      )}
    </div>
  );
}

/** A source that produced no reviewable action: still running, failed, or nothing found. */
function JobRow({ job }: { job: JobView }) {
  const running = job.status === 'analyzing';
  const failed = job.status === 'error';
  return (
    <li
      className={clsx(
        'flex items-center gap-4 px-5 py-3.5',
        running && 'bg-bc-blue-50/40',
        failed && 'bg-red-50/40',
      )}
    >
      <div
        className={clsx(
          'grid size-11 shrink-0 place-items-center rounded-lg',
          running && 'bg-bc-blue-50 text-bc-blue-500',
          failed && 'bg-red-50 text-bc-red',
          !running && !failed && 'bg-bc-surface text-bc-muted',
        )}
      >
        {running ? <Spinner className="size-5" /> : failed ? <AlertIcon className="size-5" /> : <DocIcon className="size-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-bc-ink">{job.filename}</p>
        <p className="mt-0.5 truncate text-[12.5px] text-bc-muted">
          {running
            ? 'Reading the source, matching against the channel, and drafting actions…'
            : (job.note ?? (failed ? 'Analysis failed.' : 'No products found in this source.'))}
        </p>
      </div>
      <Badge tone={running ? 'blue' : failed ? 'red' : 'neutral'} className="shrink-0">
        {running ? 'Analyzing' : failed ? 'Failed' : 'No actions'}
      </Badge>
    </li>
  );
}

function SourceThumb({ action }: { action: ActionView }) {
  const image = action.payload.image;
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/uploads/${encodeURIComponent(image.path)}`}
        alt=""
        className="size-11 shrink-0 rounded-lg border border-bc-line bg-bc-surface object-contain"
      />
    );
  }
  const Icon = action.source_type === 'text' ? TextIcon : DocIcon;
  return (
    <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-bc-blue-50 text-bc-blue-500">
      <Icon className="size-5" />
    </div>
  );
}

function TopBar({ store }: { store: StoreInfo | null }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-bc-ink text-white shadow-sm">
          <BoxIcon className="size-5" />
        </div>
        <div>
          <h1 className="text-[17px] font-semibold tracking-tight text-bc-ink">Product Enricher</h1>
          <p className="text-xs text-bc-muted">
            Catalog enrichment from documents and images
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2.5 rounded-xl border border-bc-line bg-white px-3.5 py-2 shadow-xs">
        <span
          className={clsx(
            'size-2 shrink-0 rounded-full',
            store?.connected ? 'bg-bc-green' : store ? 'bg-bc-red' : 'bg-bc-line',
          )}
          title={store?.connected ? 'Connected' : store?.error ?? 'Connecting…'}
        />
        <div className="text-[12px] leading-tight">
          <p className="font-semibold text-bc-ink">
            {store?.storeName ?? 'Connecting…'}
            {store?.productCount !== undefined && (
              <span className="tnum ml-1.5 font-normal text-bc-muted">
                {store.productCount} products
              </span>
            )}
          </p>
          <p className="text-bc-muted">
            {store?.channelName}
            {store?.model && <> · {store.model}</>}
          </p>
        </div>
        <ImageIcon className="hidden size-0" />
      </div>
    </header>
  );
}
