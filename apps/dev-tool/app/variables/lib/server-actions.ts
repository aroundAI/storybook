'use server';

import { revalidatePath } from 'next/cache';

import { envVariables } from '@/app/variables/lib/env-variables-model';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:url';
import { z } from 'zod';

const Schema = z.object({
  name: z.string().min(1),
  value: z.string(),
  mode: z.enum(['development', 'production']),
});

/**
 * Update the environment variable in the specified file.
 * @param props
 */
export async function updateEnvironmentVariableAction(
  props: z.infer<typeof Schema>,
) {
  // Validate the input
  const { name, mode, value } = Schema.parse(props);
  const root = resolve(process.cwd(), '..');
  const model = envVariables.find((item) => item.name === name);

  // Determine the source file based on the mode
  const source = (() => {
    const isSecret = model?.secret ?? true;

    switch (mode) {
      case 'development':
        if (isSecret) {
          return '.env.local';
        } else {
          return '.env.development';
        }

      case 'production':
        if (isSecret) {
          return '.env.production.local';
        } else {
          return '.env.production';
        }

      default:
        throw new Error(`Invalid mode: ${mode}`);
    }
  })();

  // check file exists, if not, create it
  const filePath = `${root}/apps/web/${source}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, '', 'utf8');
  }

  const sourceEnvFile = readFileSync(`${root}apps/web/${source}`, 'utf8');

  let updatedEnvFile = '';
  const isInSourceFile = sourceEnvFile.includes(name);
  const isCommentedOut = sourceEnvFile.includes(`#${name}=`);

  if (isInSourceFile && !isCommentedOut) {
    updatedEnvFile = sourceEnvFile.replace(
      new RegExp(`^${name}=.*`, 'm'),
      `${name}=${value}`,
    );
  } else {
    // if the key does not exist, append it to the end of the file
    updatedEnvFile = `${sourceEnvFile}\n${name}=${value}`;
  }

  // write the updated content back to the file
  writeFileSync(`${root}/apps/web/${source}`, updatedEnvFile, 'utf8');

  revalidatePath(`/variables`);

  return {
    success: true,
    message: `Updated ${name} in "${source}"`,
  };
}
