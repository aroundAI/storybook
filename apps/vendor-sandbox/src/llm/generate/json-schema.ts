import { stringForField } from '../../corpus';
import type { GenerateContext } from './context';
import { arrayLength, distinctItems, numberForField } from './values';

/** The subset of JSON Schema the prompt files use. */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
}

/**
 * A value valid against `schema`, filled from the corpus by field name.
 * Throws on a keyword or type it does not handle, naming the path.
 */
export function generateFromJsonSchema(
  schema: JsonSchema,
  ctx: GenerateContext,
  path: string[] = [],
): unknown {
  if (schema.enum) {
    const choices = schema.enum.filter((v) => v !== null);
    return choices.length > 0 && ctx.rng.chance(0.9)
      ? ctx.rng.pick(choices)
      : (schema.enum[0] ?? null);
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : [schema.type ?? 'object'];
  const type = types.find((t) => t !== 'null') ?? 'null';

  switch (type) {
    case 'object': {
      const required = new Set(schema.required ?? []);
      const out: Record<string, unknown> = {};
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        if (!required.has(key) && !ctx.rng.chance(0.85)) continue;
        out[key] = generateFromJsonSchema(property, ctx, [...path, key]);
      }
      return out;
    }
    case 'array': {
      if (!schema.items)
        throw new Error(
          `vendor-sandbox: array without items at ${path.join('.')}`,
        );
      const items = schema.items;
      const length = arrayLength(path, ctx, {
        min: schema.minItems,
        max: schema.maxItems,
        ofStrings: items.type === 'string',
      });
      return distinctItems(length, (i) =>
        generateFromJsonSchema(items, ctx, [...path, String(i)]),
      );
    }
    case 'string': {
      const placed = stringForField(path, ctx.rng, ctx.cast);
      if (!placed.placed)
        ctx.unplaced.add(path.filter((p) => !/^\d+$/.test(p)).join('.'));
      return schema.maxLength
        ? placed.value.slice(0, schema.maxLength)
        : placed.value;
    }
    case 'number':
    case 'integer':
      return numberForField(path, ctx, {
        min: schema.minimum,
        max: schema.maximum,
        integer: type === 'integer',
      });
    case 'boolean':
      return ctx.rng.chance(0.6);
    case 'null':
      return null;
    default:
      throw new Error(
        `vendor-sandbox: no generator for JSON Schema type ${type} at ${path.join('.')}`,
      );
  }
}
