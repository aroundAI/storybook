'use server';

import fs from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { getLogger } from '@kit/shared/logger';

import type { PromptTemplate, RenderedPrompt } from '../types';

/**
 * Cache for discovered prompt directories to avoid repeated filesystem scans
 */
let promptDirectoriesCache: string[] | null = null;

/**
 * Discover all feature package prompt directories
 * Searches for /packages/features/[package]/src/prompts/ directories
 *
 * @returns Array of absolute paths to prompt directories
 */
async function discoverPromptDirectories(): Promise<string[]> {
  // Return cached result if available
  if (promptDirectoriesCache) {
    return promptDirectoriesCache;
  }

  const directories: string[] = [];

  // Get the path to packages/features directory
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // From prompt-engine/src/lib/server, go up to packages/features
  const featuresDir = join(__dirname, '../../../../');

  try {
    const entries = await fs.readdir(featuresDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const promptsPath = join(featuresDir, entry.name, 'src', 'prompts');

        // Check if prompts directory exists
        try {
          await fs.access(promptsPath);
          directories.push(promptsPath);
        } catch {
          // Directory doesn't exist, skip
        }
      }
    }
  } catch (error) {
    const logger = await getLogger();
    logger.warn(
      {
        name: 'discover-prompt-directories',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Failed to discover prompt directories',
    );
  }

  // Check for custom PROMPTS_DIR environment variable
  if (process.env.PROMPTS_DIR) {
    directories.unshift(process.env.PROMPTS_DIR);
  }

  // Cache the result
  promptDirectoriesCache = directories;

  return directories;
}

/**
 * Recursively search for a prompt file in all subdirectories
 *
 * @param dir - Directory to search in
 * @param slug - Prompt slug (filename without .json extension)
 * @returns Full path to the prompt file, or null if not found
 */
async function findPromptRecursively(
  dir: string,
  slug: string,
): Promise<string | null> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively search subdirectories
        const found = await findPromptRecursively(fullPath, slug);
        if (found) return found;
      } else if (entry.isFile() && entry.name === `${slug}.json`) {
        // Found the file
        return fullPath;
      }
    }
  } catch {
    // Directory doesn't exist or can't be read, skip
    return null;
  }

  return null;
}

/**
 * Search for a prompt across all discovered prompt directories
 *
 * @param slug - Prompt slug (filename without .json extension)
 * @returns Tuple of [filePath, searchedDirs] or [null, searchedDirs]
 */
async function findPromptAcrossPackages(
  slug: string,
): Promise<[string | null, string[]]> {
  const promptDirs = await discoverPromptDirectories();

  for (const dir of promptDirs) {
    const found = await findPromptRecursively(dir, slug);
    if (found) {
      return [found, promptDirs];
    }
  }

  return [null, promptDirs];
}

/**
 * Load and render a prompt template from JSON file
 *
 * @param slug - Prompt slug (filename without .json extension or relative path like 'business-plan/competitive-analysis')
 * @param variables - Variables to interpolate into the template
 * @returns Rendered prompt ready for LLM execution
 *
 * @example
 * ```typescript
 * // Direct filename - searches recursively in all subfolders
 * const prompt1 = loadAndRenderPrompt('cluster-problems-from-posts', {
 *   post_count: 5,
 *   posts_context: '<posts>...</posts>'
 * });
 *
 * // With subfolder path
 * const prompt2 = loadAndRenderPrompt('business-plan/competitive-analysis', {
 *   problem_title: 'Example',
 *   ...
 * });
 * ```
 */
export async function loadAndRenderPrompt(
  slug: string,
  variables: Record<string, unknown>,
): Promise<RenderedPrompt> {
  // 1. Load JSON file from prompts/ directories across all feature packages
  // This searches for prompts in all /packages/features/[package]/src/prompts/ directories
  let filePath: string | undefined;
  let content: string | undefined;

  // If slug contains '/', it might be a direct path or namespace/slug format
  // Try both approaches for backward compatibility
  if (slug.includes('/')) {
    // First try: search across all packages for the full slug
    const [foundPath, searchedDirs] = await findPromptAcrossPackages(
      slug.replace('/', '-'),
    );

    if (foundPath) {
      filePath = foundPath;
      content = await fs.readFile(filePath, 'utf-8');
    } else {
      // Second try: treat as direct path in each prompt directory
      const promptDirs = await discoverPromptDirectories();

      for (const dir of promptDirs) {
        const testPath = join(dir, `${slug}.json`);
        try {
          const fileContent = await fs.readFile(testPath, 'utf-8');
          content = fileContent;
          filePath = testPath;
          break;
        } catch {
          // File doesn't exist in this directory, continue
        }
      }

      if (!content || !filePath) {
        throw new Error(
          `Prompt template not found: ${slug}.json. Searched in:\n${searchedDirs.map((d) => `  - ${d}`).join('\n')}`,
        );
      }
    }
  } else {
    // Search recursively across all feature package prompt directories
    const [foundPath, searchedDirs] = await findPromptAcrossPackages(slug);

    if (!foundPath) {
      throw new Error(
        `Prompt template not found: ${slug}.json. Searched recursively in:\n${searchedDirs.map((d) => `  - ${d}`).join('\n')}\n\nTo add prompts, place them in: packages/features/<your-package>/src/prompts/`,
      );
    }

    filePath = foundPath;
    content = await fs.readFile(filePath, 'utf-8');
  }

  // At this point, both filePath and content are guaranteed to be defined
  // (or an error would have been thrown)
  if (!content || !filePath) {
    throw new Error(
      `Unexpected error: content or filePath is undefined for slug: ${slug}`,
    );
  }

  // 2. Parse JSON
  let template: PromptTemplate;
  try {
    template = JSON.parse(content) as PromptTemplate;
  } catch (error) {
    throw new Error(
      `Failed to parse prompt template ${slug}: ${error instanceof Error ? error.message : 'Invalid JSON'}`,
    );
  }

  // 3. Validate required variables are provided
  const missingVars: string[] = [];
  for (const [varName, varDef] of Object.entries(template.variables)) {
    if (varDef.required && !(varName in variables)) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required variables for prompt ${slug}: ${missingVars.join(', ')}`,
    );
  }

  // 4. Interpolate variables in user prompt
  const userPrompt = interpolateVariables(template.user_prompt, variables);

  // 5. Compose system prompts (sort by order, then concatenate)
  const systemPrompt = template.system_prompts
    .sort((a, b) => a.order - b.order)
    .map((sp) => sp.content)
    .join('\n\n');

  // 6. Return rendered prompt
  return {
    systemPrompt,
    userPrompt,
    llmConfig: {
      provider: template.llm.provider,
      model: template.llm.model,
      temperature: template.llm.temperature,
      max_tokens: template.llm.max_tokens,
      response_format: template.llm.response_format,
    },
    output: template.output,
    version: template.version,
    slug: template.slug,
  };
}

/**
 * Interpolate variables into template string
 * Replaces {{variable_name}} with actual values
 *
 * @param template - Template string with {{variable}} placeholders
 * @param variables - Object with variable values
 * @returns String with variables replaced
 */
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = String(value);
    result = result.replaceAll(placeholder, replacement);
  }

  return result;
}

/**
 * Clear the prompt directories cache
 * Useful when prompts are added at runtime
 */
export async function clearPromptCache(): Promise<void> {
  promptDirectoriesCache = null;
}
