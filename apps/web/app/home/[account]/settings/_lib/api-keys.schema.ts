import { z } from 'zod';

// Valid providers from database constraint
export const ApiKeyProviders = [
    'kling',
    'runway',
    'hailuo',
    'elevenlabs',
    'playht',
    'suno',
    'claude',
    'openai',
    'gemini',
] as const;

export type ApiKeyProvider = (typeof ApiKeyProviders)[number];

export const GetApiKeysSchema = z.object({
    accountSlug: z.string().min(1),
});

export const SaveApiKeySchema = z.object({
    accountSlug: z.string().min(1),
    provider: z.enum(ApiKeyProviders),
    apiKey: z.string().min(10, 'API key must be at least 10 characters'),
});

export const DeleteApiKeySchema = z.object({
    accountSlug: z.string().min(1),
    provider: z.enum(ApiKeyProviders),
});

export const ValidateApiKeySchema = z.object({
    provider: z.enum(ApiKeyProviders),
    apiKey: z.string().min(1),
});

export interface ApiKeyInfo {
    provider: ApiKeyProvider;
    lastFourChars: string;
    isActive: boolean;
}

export interface ValidationResult {
    valid: boolean;
    error?: string;
}
