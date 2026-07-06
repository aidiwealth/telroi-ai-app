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
    // pdf-parse v1: simple default-export function, no separate pdfjs worker file
    // (bundles cleanly in the server output, unlike v2 which needs pdf.worker.mjs).
    const pdfParse = (await import('pdf-parse')).default as (b: Buffer) => Promise<{ text: string }>;
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
