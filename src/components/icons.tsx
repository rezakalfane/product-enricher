/* Minimal stroked icon set, sized by the parent's font-size / explicit class. */
type P = { className?: string };
const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
};

export const UploadIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" /></svg>
);
export const TextIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M4 6h16M4 11h16M4 16h10" /></svg>
);
export const ImageIcon = (p: P) => (
  <svg {...base} className={p.className}><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="m4 17 4.5-4.5L13 17m0 0 3-3 4 4" /></svg>
);
export const DocIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const XIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const SparkIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.5 10.2 12.6 4.5 10.8 10.2 9z" /><path d="M18.5 3.5v3M20 5h-3" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base} className={p.className}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
);
export const LinkIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 1 0-5.7-5.7L11.5 6.8" /><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.3 2.3a4 4 0 1 0 5.7 5.7l1.3-1.3" /></svg>
);
export const AlertIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M12 4.5 2.8 20h18.4z" /><path d="M12 10v4m0 3h.01" /></svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M4 7h16M9.5 7V5h5v2M6.5 7l1 13h9l1-13M10 11v6M14 11v6" /></svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M12 5v14M5 12h14" /></svg>
);
export const BoxIcon = (p: P) => (
  <svg {...base} className={p.className}><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
);
