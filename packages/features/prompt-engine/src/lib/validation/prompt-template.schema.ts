import { z } from 'zod';

/**
 * Zod Schema for Prompt Template Validation
 *
 * This schema validates the structure of prompt JSON files at runtime.
 * Use this to ensure all prompts conform to the standard format.
 */

/**
 * System prompt schema
 */
export const SystemPromptSchema = z.object({
  slug: z.string().min(1, 'System prompt slug cannot be empty'),
  name: z.string().min(1, 'System prompt name cannot be empty'),
  content: z.string().min(1, 'System prompt content cannot be empty'),
  layer_type: z.string().min(1, 'System prompt layer_type cannot be empty'),
  scope: z.string().min(1, 'System prompt scope cannot be empty'),
  order: z.number().int().min(0, 'System prompt order must be >= 0'),
});

/**
 * Prompt variable schema
 */
export const PromptVariableSchema = z.object({
  type: z.enum(['text', 'number', 'boolean', 'array', 'object']),
  required: z.boolean(),
  description: z.string().optional(),
});

/**
 * LLM configuration schema
 */
export const LLMConfigSchema = z.object({
  provider: z.string().min(1, 'LLM provider cannot be empty'),
  model: z.string().min(1, 'LLM model cannot be empty'),
  max_tokens: z.number().int().positive('max_tokens must be positive'),
  temperature: z.number().min(0).max(2, 'Temperature must be between 0 and 2'),
  response_format: z
    .object({
      type: z.enum(['json_object', 'text']),
    })
    .optional(),
  reasoning: z.string().optional(),
});

/**
 * Output schema definition
 */
export const OutputSchemaDefinition = z.object({
  type: z.enum(['object', 'array'], {
    errorMap: () => ({ message: 'Output type must be "object" or "array"' }),
  }),
  wrapper_key: z.string().optional(),
  schema: z
    .object({
      type: z.literal('zod', {
        errorMap: () => ({ message: 'Schema type must be "zod"' }),
      }),
      definition: z
        .string()
        .min(1, 'Schema definition cannot be empty')
        .refine((def) => def.includes('z.object(') || def.includes('z.array('), {
          message: 'Schema definition must be a valid Zod schema string',
        }),
    })
    .optional(),
  schema_for_llm: z.string().optional(),
  example_output: z.any().optional(),
});

/**
 * Complete prompt template schema
 */
export const PromptTemplateSchema = z
  .object({
    // Core metadata
    slug: z
      .string()
      .min(1, 'Slug cannot be empty')
      .regex(
        /^[a-z0-9-]+$/,
        'Slug must be kebab-case (lowercase letters, numbers, hyphens)',
      ),
    name: z.string().min(1, 'Name cannot be empty'),
    version: z.number().int().positive('Version must be positive integer'),
    category: z.string().min(1, 'Category cannot be empty'),
    description: z
      .string()
      .min(10, 'Description must be at least 10 characters'),
    exported_at: z.string().datetime('exported_at must be ISO 8601 timestamp'),

    // LLM configuration
    llm: LLMConfigSchema,

    // Prompt content
    system_prompts: z.array(SystemPromptSchema),
    user_prompt: z.string().min(1, 'user_prompt cannot be empty'),
    variables: z.record(z.string(), PromptVariableSchema),

    // Output schema (optional)
    output: OutputSchemaDefinition.optional(),

    // Optional metadata
    metadata: z.record(z.string(), z.any()).optional(),
  })
  .strict(); // Disallow unknown fields

/**
 * Type inference from schema
 */
export type PromptTemplateSchemaType = z.infer<typeof PromptTemplateSchema>;

/**
 * Validation helper with detailed error messages
 *
 * @param data - Raw prompt template object to validate
 * @returns Validated prompt template
 * @throws ZodError with detailed field-level errors
 */
export function validatePromptTemplate(
  data: unknown,
): PromptTemplateSchemaType {
  return PromptTemplateSchema.parse(data);
}

/**
 * Safe validation helper that returns success/error result
 *
 * @param data - Raw prompt template object to validate
 * @returns Success with data or error with issues
 */
export function safeValidatePromptTemplate(data: unknown) {
  return PromptTemplateSchema.safeParse(data);
}

/**
 * Validate that variable placeholders in user_prompt match variables object
 *
 * @param template - Validated prompt template
 * @returns Array of validation errors (empty if valid)
 */
export function validateVariablePlaceholders(
  template: PromptTemplateSchemaType,
): string[] {
  const errors: string[] = [];

  // Extract all {{variable}} placeholders from user_prompt
  const placeholderRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
  const matches = template.user_prompt.matchAll(placeholderRegex);
  const usedVariables = new Set<string>();

  for (const match of matches) {
    const varName = match[1];

    if (varName) {
      usedVariables.add(varName);
    }
  }

  // Check that all used variables are defined
  for (const varName of usedVariables) {
    if (!template.variables[varName]) {
      errors.push(
        `Variable {{${varName}}} used in user_prompt but not defined in variables object`,
      );
    }
  }

  // Check that all defined variables are used
  const definedVariables = Object.keys(template.variables);

  for (const varName of definedVariables) {
    if (!usedVariables.has(varName)) {
      errors.push(
        `Variable '${varName}' defined in variables object but not used in user_prompt`,
      );
    }
  }

  return errors;
}

/**
 * Validate that Zod schema definition is valid by attempting to compile it
 *
 * @param schemaDefinition - Zod schema string (e.g., "z.object({ ... })")
 * @returns Compilation result with success flag and error if failed
 */
export function validateZodSchemaCompilation(schemaDefinition: string): {
  success: boolean;
  error?: string;
  schema?: z.ZodTypeAny;
} {
  try {
    // Create safe eval context with only 'z' available
    const schema = eval(`(function(z) { return ${schemaDefinition}; })`)(z);

    // Verify it's a Zod schema
    if (!schema || typeof schema.parse !== 'function') {
      return {
        success: false,
        error: 'Schema definition does not produce a valid Zod schema',
      };
    }

    return { success: true, schema };
  } catch (error) {
    return {
      success: false,
      error: `Schema compilation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Validate example_output against its Zod schema
 *
 * @param template - Validated prompt template with example_output
 * @returns Validation result with success flag and error if failed
 */
export function validateExampleOutput(template: PromptTemplateSchemaType): {
  success: boolean;
  error?: string;
} {
  if (!template.output?.example_output) {
    return { success: true }; // No example to validate
  }

  if (!template.output.schema) {
    return { success: true }; // No schema to validate against
  }

  // Compile the Zod schema
  const compilationResult = validateZodSchemaCompilation(
    template.output.schema.definition,
  );

  if (!compilationResult.success) {
    return {
      success: false,
      error: `Cannot validate example_output: ${compilationResult.error}`,
    };
  }

  try {
    // Validate example_output directly against schema
    // Note: When wrapper_key is present, the schema should define the full object structure
    // e.g., z.object({ items: z.array(...) }) not just z.array(...)
    compilationResult.schema!.parse(template.output.example_output);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `example_output validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
