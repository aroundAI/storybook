import { z } from 'zod';

export const zodParseFactory =
  <T extends z.ZodTypeAny>(schema: T) =>
  (data: unknown): z.infer<T> => {
    try {
      return schema.parse(data) as unknown;
    } catch (err) {
      const zodErr =
        err instanceof z.ZodError
          ? err.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; ')
          : String(err);

      console.error('[ZodParse] Validation failed:', zodErr);

      throw new Error(`Invalid data: ${zodErr}`);
    }
  };
