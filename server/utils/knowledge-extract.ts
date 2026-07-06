// Extract plain text from an uploaded knowledge-base document (PDF / Word / text).
// Returns the parsed text (trimmed) plus a normalized fileType tag. Kept resilient:
// throws a clear error the upload endpoint can surface to the client on failure.

export type KbFileType = 'pdf' | 'docx' | 'txt' | 'md';

export function detectFileType(fileName: string, mimeType?: string): KbFileType | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt';
  return null;
}

export async function extractText(buffer: Buffer, fileType: KbFileType): Promise<string> {
  if (fileType === 'txt' || fileType === 'md') {
    return buffer.toString('utf-8');
  }
  if (fileType === 'pdf') {
    // Import pdf-parse's inner lib directly, NOT the package index.js. The index
    // has debug-on-import code (reads ./test/data/*.pdf when module.parent is
    // undefined) that throws ENOENT in a bundled/ESM server. The lib module is the
    // pure parser with no such side effect, and v1 bundles cleanly (no pdfjs worker).
    const mod = await import('pdf-parse/lib/pdf-parse.js') as any;
    const pdfParse = (mod.default || mod) as (b: Buffer) => Promise<{ text: string }>;
    const res = await pdfParse(buffer);
    return res?.text || '';
  }
  if (fileType === 'docx') {
    const mammoth = await import('mammoth');
    const res = await mammoth.extractRawText({ buffer });
    return res.value || '';
  }
  throw new Error(`Unsupported file type: ${fileType}`);
}

/** Collapse excessive whitespace so stored/injected text is compact. */
export function normalizeText(text: string): string {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}


// Extract readable text from an HTML page: drop scripts/styles/nav/footer chrome,
// keep headings, paragraphs, and lists. Used for the "import from website URL"
// knowledge source. Lazy import so cheerio only loads when scraping.
export async function extractHtmlText(html: string): Promise<string> {
  const { load } = await import('cheerio');
  const $ = load(html);
  // Remove non-content elements.
  $('script, style, noscript, iframe, svg, nav, header, footer, form, button, input, [aria-hidden="true"]').remove();
  // Prefer a main/article container if present; else fall back to body.
  const root = $('main').length ? $('main') : ($('article').length ? $('article') : $('body'));
  const title = ($('title').first().text() || '').trim();
  const bodyText = root.text();
  const combined = (title ? title + '\n\n' : '') + bodyText;
  return combined;
}
