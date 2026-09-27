import { z } from 'zod';

import { stringForField, uuid } from '../../corpus';
import type { GenerateContext } from './context';
import {
  arrayLength,
  castListContexts,
  distinctItems,
  numberForField,
} from './values';

/**
 * Compiles a prompt's Zod definition exactly as the executor does
 * (`llm-executor.ts`: `eval('(function(z) { return ' + definition + '; })')(z)`).
 * The definitions are checked-in files; this extends them the same trust the
 * executor already does, and nothing from a request is ever evaluated.
 */
export function compileZodDefinition(definition: string): z.ZodTypeAny {
  return eval(`(function(z) { return ${definition}; })`)(z) as z.ZodTypeAny;
}

interface Check {
  kind: string;
  value?: number;
  inclusive?: boolean;
}

type Def = {
  typeName: string;
  checks?: Check[];
  [key: string]: unknown;
};

function defOf(schema: z.ZodTypeAny) {
  return schema._def as Def;
}

function check(def: Def, kind: string) {
  return def.checks?.find((c) => c.kind === kind);
}

function fitLength(
  value: string,
  min: number | undefined,
  max: number | undefined,
  more: () => string,
) {
  let out = value;
  while (min !== undefined && out.length < min) out = `${out} ${more()}`;
  if (max !== undefined && out.length > max) {
    const cut = out.slice(0, max);
    const space = cut.lastIndexOf(' ');
    out = (space > max * 0.6 ? cut.slice(0, space) : cut).replace(
      /[\s,;:]+$/,
      '',
    );
  }
  return out;
}

/**
 * A value of `schema`'s shape, filled with realistic words by field name.
 * Throws on a Zod type it does not know, naming the path - found by the
 * every-prompt test, never by a user.
 */
export function generateFromZod(
  schema: z.ZodTypeAny,
  ctx: GenerateContext,
  path: string[] = [],
): unknown {
  const def = defOf(schema);

  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (schema as z.AnyZodObject).shape as Record<
        string,
        z.ZodTypeAny
      >;
      const out: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        const optional = field.isOptional();
        if (optional && !ctx.rng.chance(0.85)) continue;
        const value = generateFromZod(field, ctx, [...path, key]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }

    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodReadonly':
    case 'ZodBranded':
    case 'ZodCatch':
      return generateFromZod(
        (def.innerType ?? def.type) as z.ZodTypeAny,
        ctx,
        path,
      );

    case 'ZodEffects':
      return generateFromZod(def.schema as z.ZodTypeAny, ctx, path);

    case 'ZodPipeline':
      return generateFromZod(def.in as z.ZodTypeAny, ctx, path);

    case 'ZodLazy':
      return generateFromZod((def.getter as () => z.ZodTypeAny)(), ctx, path);

    case 'ZodString': {
      if (check(def, 'uuid')) return uuid(ctx.rng);
      if (check(def, 'url'))
        return `https://sandbox.localhost/files/${uuid(ctx.rng)}`;
      if (check(def, 'datetime'))
        return new Date(
          Date.UTC(2026, 0, 1 + ctx.rng.int(0, 300)),
        ).toISOString();

      const placed = stringForField(path, ctx.rng, ctx.cast);
      if (!placed.placed)
        ctx.unplaced.add(path.filter((p) => !/^\d+$/.test(p)).join('.'));

      const exact = check(def, 'length')?.value;
      return fitLength(
        placed.value,
        exact ?? check(def, 'min')?.value,
        exact ?? check(def, 'max')?.value,
        () => stringForField(path, ctx.rng, ctx.cast).value,
      );
    }

    case 'ZodNumber': {
      const min = check(def, 'min');
      const max = check(def, 'max');
      return numberForField(path, ctx, {
        min: min
          ? min.value! + (min.inclusive === false ? 1e-6 : 0)
          : undefined,
        max: max
          ? max.value! - (max.inclusive === false ? 1e-6 : 0)
          : undefined,
        integer: Boolean(check(def, 'int')),
      });
    }

    case 'ZodBigInt':
      return BigInt(ctx.rng.int(1, 100));

    case 'ZodBoolean':
      return ctx.rng.chance(0.6);

    case 'ZodDate':
      return new Date(Date.UTC(2026, 0, 1 + ctx.rng.int(0, 300)));

    case 'ZodLiteral':
      return def.value;

    case 'ZodEnum':
      return ctx.rng.pick(def.values as string[]);

    case 'ZodNativeEnum':
      return ctx.rng.pick(
        Object.values(def.values as Record<string, string | number>).filter(
          (v) => typeof v === 'string' || !Number.isNaN(v),
        ),
      );

    case 'ZodArray': {
      const length = arrayLength(path, ctx, {
        min:
          (def.exactLength as Check | null)?.value ??
          (def.minLength as Check | null)?.value,
        max:
          (def.exactLength as Check | null)?.value ??
          (def.maxLength as Check | null)?.value,
        ofStrings: defOf(def.type as z.ZodTypeAny).typeName === 'ZodString',
      });
      const perPerson = castListContexts(path, ctx, length, {
        min:
          (def.exactLength as Check | null)?.value ??
          (def.minLength as Check | null)?.value,
        ofObjects: defOf(def.type as z.ZodTypeAny).typeName === 'ZodObject',
      });
      if (perPerson)
        return perPerson.map((itemCtx, i) =>
          generateFromZod(def.type as z.ZodTypeAny, itemCtx, [
            ...path,
            String(i),
          ]),
        );
      return distinctItems(length, (i) =>
        generateFromZod(def.type as z.ZodTypeAny, ctx, [...path, String(i)]),
      );
    }

    case 'ZodTuple':
      return (def.items as z.ZodTypeAny[]).map((item, i) =>
        generateFromZod(item, ctx, [...path, String(i)]),
      );

    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = def.options as
        | z.ZodTypeAny[]
        | Map<unknown, z.ZodTypeAny>;
      const list = options instanceof Map ? [...options.values()] : options;
      return generateFromZod(ctx.rng.pick(list), ctx, path);
    }

    case 'ZodRecord': {
      const entries = ctx.rng.shuffle(ctx.cast.people).slice(0, 2);
      return Object.fromEntries(
        entries.map((key) => [
          key,
          generateFromZod(def.valueType as z.ZodTypeAny, ctx, [...path, key]),
        ]),
      );
    }

    case 'ZodNull':
      return null;

    case 'ZodAny':
    case 'ZodUnknown':
      return stringForField(path, ctx.rng, ctx.cast).value;

    default:
      throw new Error(
        `vendor-sandbox: no generator for ${def.typeName} at ${path.join('.') || '(root)'}`,
      );
  }
}
