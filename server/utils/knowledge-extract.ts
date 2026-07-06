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
    // pdf-parse v2 uses a PDFParse class: new PDFParse({ data }) -> getText().
    // Lazy import so the heavy PDF lib only loads when a PDF is actually parsed.
    const mod = await import('pdf-parse') as any;
    const PDFParse = mod.PDFParse;
    // Point pdfjs at its bundled worker in node_modules so the parser can find it
    // in the server build (avoids "Cannot find module pdf.worker.mjs").
    try {
      if (PDFParse.setWorker && PDFParse.isNodeJS) {
        const { createRequire } = await import('node:module');
        const require = createRequire(import.meta.url);
        const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
        PDFParse.setWorker(workerPath);
      }
    } catch { /* fall back to default worker resolution */ }
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      return res?.text || '';
    } finally {
      try { await parser.destroy(); } catch { /* noop */ }
    }
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
