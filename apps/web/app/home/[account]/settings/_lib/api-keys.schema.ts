import { z } from 'zod';

// Providers a key can be saved for: a subset of the external_api_keys check
// constraint, which still admits a retired vendor's stored rows (FILM-514).
export const ApiKeyProviders = [
  'kling',
  'runway',
  'hailuo',
  'elevenlabs',
  'playht',
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
  /** Owners only; null for every other role on the account (KB-84). */
  lastFourChars: string | null;
  isActive: boolean;
}

export interface ApiKeysOverview {
  /** Whether the viewer may add, replace or remove keys: account owners. */
  canManage: boolean;
  keys: ApiKeyInfo[];
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
