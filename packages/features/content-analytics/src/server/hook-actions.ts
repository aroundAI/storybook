'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { refreshTestRetention } from './hook-retention';

/**
 * Hook classifications tested by the Hook Lab. Kept in step with the
 * `hook_type` taxonomy dimension (FILM-1507) so aggregate hook
 * performance across all published content comes for free.
 */
const HookTypeSchema = z.enum([
  'negative_bias',
  'visual_asmr',
  'question',
  'pattern_interrupt',
  'authority',
  'other',
]);

const CreateHookTestSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(200),
  topic: z.string().min(1).max(500),
  hypothesis: z.string().max(2000).optional(),
  viralThreshold: z.number().min(0.01).max(1).default(0.75),
});

const AddHookVariantSchema = z.object({
  testId: z.string().uuid(),
  hookType: HookTypeSchema,
  label: z.string().max(100).optional(),
  script: z.string().min(1).max(4000),
  publishId: z.string().uuid().optional(),
  durationSeconds: z.number().min(1).max(600).default(5),
});

export const createHookTestAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    const { data: test, error } = await client
      .from('hook_tests')
      .insert({
        account_id: data.accountId,
        project_id: data.projectId,
        name: data.name,
        topic: data.topic,
        hypothesis: data.hypothesis ?? null,
        viral_threshold: data.viralThreshold,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error || !test) {
      throw new Error(`Failed to create hook test: ${error?.message}`);
    }

    return { id: test.id };
  },
  { schema: CreateHookTestSchema, auth: true },
);

export const addHookVariantAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();

    const { data: variant, error } = await client
      .from('hook_variants')
      .insert({
        test_id: data.testId,
        hook_type: data.hookType,
        label: data.label ?? null,
        script: data.script,
        publish_id: data.publishId ?? null,
        duration_seconds: data.durationSeconds,
      })
      .select('id')
      .single();

    if (error || !variant) {
      throw new Error(`Failed to add variant: ${error?.message}`);
    }

    return { id: variant.id };
  },
  { schema: AddHookVariantSchema, auth: true },
);

/**
 * Pulls fresh retention for every variant and re-evaluates the winner.
 */
export const refreshHookTestAction = enhanceAction(
  async ({ testId }) => {
    const client = getSupabaseServerClient();

    // RLS scopes this read; a caller without access gets no row
    const { data: test } = await client
      .from('hook_tests')
      .select('id')
      .eq('id', testId)
      .maybeSingle();

    if (!test) {
      throw new Error('Hook test not found or access denied');
    }

    return refreshTestRetention(client, testId);
  },
  { schema: z.object({ testId: z.string().uuid() }), auth: true },
);

export const listHookTestsAction = enhanceAction(
  async ({ accountId, projectId }) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('hook_tests')
      .select('id, name, topic, hypothesis, status, viral_threshold, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    if (projectId) query = query.eq('project_id', projectId);

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list hook tests: ${error.message}`);
    }

    return data ?? [];
  },
  {
    schema: z.object({
      accountId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
    }),
    auth: true,
  },
);

export const getHookTestAction = enhanceAction(
  async ({ testId }) => {
    const client = getSupabaseServerClient();

    const { data: test, error } = await client
      .from('hook_tests')
      .select('*')
      .eq('id', testId)
      .single();

    if (error || !test) {
      throw new Error('Hook test not found or access denied');
    }

    const { data: variants } = await client
      .from('hook_variants')
      .select('*')
      .eq('test_id', testId)
      .order('created_at');

    return { ...test, variants: variants ?? [] };
  },
  { schema: z.object({ testId: z.string().uuid() }), auth: true },
);
