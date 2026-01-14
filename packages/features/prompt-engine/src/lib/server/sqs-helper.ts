/**
 * SQS Helper for LLM Job Queue
 *
 * Provides a simple interface for server actions to queue LLM jobs
 * for background processing.
 */
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

// Initialize SQS client
const sqs = new SQSClient({});

// Queue URL is provided by SST via the link
// In local dev, fall back to environment variable
const QUEUE_URL = process.env.LLM_JOBS_QUEUE_URL || '';

/**
 * LLM Job types for type safety
 */
export type LlmJobType =
    | 'season-analysis'
    | 'season-outline'
    | 'story-ideation'
    | 'story-generation'
    | 'screenplay-conversion'
    | 'shot-generation'
    | 'publish-metadata'
    | 'analytics-insights'
    | 'language-insights'
    | 'translate-dialogue'
    | 'dubbing-translate'
    | 'continuity-analysis'
    | 'caption-generation';

/**
 * Queue an LLM job for background processing
 *
 * @param params.jobType - Type of job (determines which handler runs)
 * @param params.userId - User ID to send results to via WebSocket
 * @param params.payload - Job-specific payload data
 * @returns Promise that resolves when message is queued
 *
 * @example
 * ```typescript
 * await queueLlmJob({
 *   jobType: 'season-analysis',
 *   userId: user.id,
 *   payload: { projectId, roadmap },
 * });
 * return { queued: true };
 * ```
 */
export async function queueLlmJob(params: {
    jobType: LlmJobType;
    userId: string;
    payload: Record<string, unknown>;
}): Promise<void> {
    if (!QUEUE_URL) {
        throw new Error(
            'LLM_JOBS_QUEUE_URL not configured. Ensure the queue is linked in sst.config.ts',
        );
    }

    console.log(`[SQS] Queuing ${params.jobType} job for user ${params.userId.substring(0, 8)}...`);

    await sqs.send(
        new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify({
                jobType: params.jobType,
                userId: params.userId,
                payload: params.payload,
            }),
            // Add message attributes for filtering/monitoring
            MessageAttributes: {
                jobType: {
                    DataType: 'String',
                    StringValue: params.jobType,
                },
            },
        }),
    );

    console.log(`[SQS] Job queued successfully`);
}

/**
 * Check if we're in a Lambda environment where SQS is available
 */
export function isLambdaEnvironment(): boolean {
    return !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!QUEUE_URL;
}
