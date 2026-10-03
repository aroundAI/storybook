/**
 * Research Document Upload API Route
 *
 * Handles file uploads for the Research Hub, extracting text from
 * PDF, DOCX, TXT, and MD files server-side.
 *
 * POST /api/research/upload
 * - Accepts multipart/form-data with a 'file' field
 * - Returns extracted text, metadata, and page count
 * - Optionally queues LLM-based fact extraction
 */
import { NextResponse } from 'next/server';

import {
  PROJECT_WRITE_REFUSAL,
  canWriteProject,
} from '@kit/episodes/lib/server/project-write-access';
import { authorizeProjectTarget } from '@kit/prompt-engine/llm-job-target';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

export async function POST(request: Request) {
  try {
    // Auth check
    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const projectId = formData.get('projectId') as string | null;
    const extractFacts = formData.get('extractFacts') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 },
      );
    }

    // Queuing fact extraction writes into the project, so the caller needs a
    // project_members row. Reading the project is not enough: public and
    // unlisted projects are readable by every signed-in user (KB-26).
    if (!(await canWriteProject(client, projectId))) {
      return NextResponse.json(
        { error: PROJECT_WRITE_REFUSAL },
        { status: 403 },
      );
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    // Validate file type
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (
      !SUPPORTED_TYPES.has(file.type) &&
      !['pdf', 'docx', 'txt', 'md', 'csv'].includes(ext ?? '')
    ) {
      return NextResponse.json(
        { error: 'Unsupported file type. Supported: PDF, DOCX, TXT, MD, CSV' },
        { status: 400 },
      );
    }

    // Extract text server-side
    const { extractTextFromFile, chunkTextForExtraction } = await import(
      '@kit/episodes/lib/server/pdf-extractor'
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, pageCount } = await extractTextFromFile(
      buffer,
      file.type,
      file.name,
    );

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'No text content could be extracted from the file' },
        { status: 422 },
      );
    }

    // Chunk for LLM processing
    const chunks = chunkTextForExtraction(text);

    // Optionally queue LLM-based fact extraction
    let factExtractionJobId: string | undefined;

    if (extractFacts) {
      const { openRunForJob } = await import('@kit/ai-gateway');

      // KB-31: queueLlmJob needs a target; the access gate above is KB-26's
      const target = await authorizeProjectTarget(client, projectId);

      if (!target) {
        return NextResponse.json(
          { error: PROJECT_WRITE_REFUSAL },
          { status: 403 },
        );
      }

      // Queue fact extraction for each chunk
      for (const chunk of chunks) {
        const run = await openRunForJob(
          {
            jobType: 'fact-extraction',
            userId: user.id,
            target,
            payload: {
              content: chunk,
              projectId,
              sourceTitle: file.name,
              sourceCitation: file.name,
              userId: user.id,
            },
            name: 'research.upload',
          },
          { client: client, accountId: target.accountId, userId: user.id },
        );
        await run.dispatch();
      }

      factExtractionJobId = `batch-${crypto.randomUUID()}`;

      console.log(
        `[Research Upload] Queued ${chunks.length} fact extraction jobs for "${file.name}"`,
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        text,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        pageCount,
        characterCount: text.length,
        chunkCount: chunks.length,
        factExtractionJobId,
      },
    });
  } catch (error) {
    console.error('[Research Upload] Error:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to process file',
      },
      { status: 500 },
    );
  }
}
