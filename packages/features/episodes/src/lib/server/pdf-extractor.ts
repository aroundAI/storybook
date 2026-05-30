/**
 * PDF/Document Text Extraction Utility
 *
 * Server-side text extraction from PDF, DOCX, TXT, and MD files.
 * Uses pdf-parse for PDFs and mammoth for DOCX.
 */

/**
 * Extract text content from a file buffer based on its MIME type.
 *
 * @param buffer - Raw file buffer
 * @param mimeType - MIME type of the file (e.g., 'application/pdf')
 * @param fileName - Original file name (used for type detection fallback)
 * @returns Extracted text content
 */
export async function extractTextFromFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ text: string; pageCount?: number }> {
  const ext = fileName.split('.').pop()?.toLowerCase();

  // PDF extraction
  if (mimeType === 'application/pdf' || ext === 'pdf') {
    return extractFromPdf(buffer);
  }

  // DOCX extraction
  if (
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    return extractFromDocx(buffer);
  }

  // Plain text / Markdown
  if (
    mimeType === 'text/plain' ||
    mimeType === 'text/markdown' ||
    ext === 'txt' ||
    ext === 'md' ||
    ext === 'csv'
  ) {
    return { text: buffer.toString('utf-8') };
  }

  throw new Error(
    `Unsupported file type: ${mimeType} (${fileName}). Supported: PDF, DOCX, TXT, MD, CSV.`,
  );
}

async function extractFromPdf(
  buffer: Buffer,
): Promise<{ text: string; pageCount?: number }> {
  try {
    // pdf-parse v1 is CJS — dynamic import wraps it
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const result = await pdfParse(buffer);

    return {
      text: result.text.trim(),
      pageCount: result.numpages,
    };
  } catch (error) {
    throw new Error(
      `PDF extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function extractFromDocx(
  buffer: Buffer,
): Promise<{ text: string; pageCount?: number }> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });

    return { text: result.value.trim() };
  } catch (error) {
    throw new Error(
      `DOCX extraction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Chunk text into segments for LLM processing.
 * Respects paragraph boundaries to avoid splitting mid-sentence.
 *
 * @param text - Full text content
 * @param maxChunkSize - Maximum characters per chunk (default ~4000 chars ≈ 1000 tokens)
 * @returns Array of text chunks
 */
export function chunkTextForExtraction(
  text: string,
  maxChunkSize = 4000,
): string[] {
  if (text.length <= maxChunkSize) return [text];

  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      // If a single paragraph exceeds max, split by sentences
      if (paragraph.length > maxChunkSize) {
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 1 > maxChunkSize) {
            if (currentChunk.length > 0) {
              chunks.push(currentChunk.trim());
              currentChunk = '';
            }
          }
          currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
      } else {
        currentChunk = paragraph;
      }
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
