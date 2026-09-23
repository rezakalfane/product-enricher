import { join } from 'node:path';
import mammoth from 'mammoth';

export type SourceKind = 'image' | 'document' | 'text';

export function classify(filename: string, mime: string): SourceKind {
  if (mime.startsWith('image/')) return 'image';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(filename)) return 'image';
  return 'document';
}

/** Pull plain text out of whatever was uploaded. Returns '' when the format carries no text. */
export async function extractText(buf: Buffer, filename: string, mime: string): Promise<string> {
  const lower = filename.toLowerCase();

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    // Loaded lazily: pdf-parse pulls in pdf.js, which is heavy and Node-only.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const out = await parser.getText();
      return out.text;
    } finally {
      await parser.destroy();
    }
  }

  if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
    try {
      const out = await mammoth.extractRawText({ buffer: buf });
      if (out.value.trim()) return out.value;
    } catch {
      // legacy .doc — fall through to the binary text salvage below
    }
    return salvageText(buf);
  }

  if (/\.(csv|tsv|txt|md|json|xml|html?)$/i.test(lower) || mime.startsWith('text/')) {
    return buf.toString('utf8');
  }

  return salvageText(buf);
}

/** Last resort for binary formats: keep runs of printable ASCII. */
function salvageText(buf: Buffer): string {
  return buf
    .toString('latin1')
    .replace(/[^\x20-\x7E\n]+/g, ' ')
    .replace(/\s{3,}/g, '\n')
    .trim();
}

/** OCR a product image. Best-effort — packshots often carry no legible text at all. */
export async function ocrImage(buf: Buffer): Promise<string> {
  try {
    const { createWorker } = await import('tesseract.js');
    // Read the bundled language data rather than downloading it and caching to cwd,
    // which is read-only on Vercel. next.config.ts traces ocr/ into the function.
    const worker = await createWorker('eng', undefined, {
      cachePath: join(process.cwd(), 'ocr'),
      cacheMethod: 'readOnly',
    });
    const { data } = await worker.recognize(buf);
    await worker.terminate();
    return data.text.trim();
  } catch {
    return '';
  }
}

/**
 * Filenames are often the strongest signal for a packshot
 * (`stanley-adventure-quencher-40oz-rose.jpg`). Split into searchable terms.
 */
export function termsFromFilename(filename: string): string[] {
  const base = filename.replace(/\.[a-z0-9]+$/i, '');
  return [
    ...new Set(
      base
        .split(/[^a-z0-9]+/i)
        .map((t) => t.trim())
        .filter(
          (t) =>
            t.length >= 3 &&
            !/^(img|dsc|photo|image|final|copy|telegram|whatsapp|v\d+|\d{1,2})$/i.test(t) &&
            // Opaque ids from chat apps (telegram-photo-AQADjhhrG1TUoVF9.jpg) match nothing.
            !/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9]{10,}$/.test(t),
        ),
    ),
  ];
}
