declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    text: string;
    version: string;
  }

  function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PDFData>;

  export default pdfParse;
}
