import type { PlopTypes } from '@turbo/gen';
import { execSync } from 'node:child_process';
import * as os from 'node:os';

export function createDockerGenerator(plop: PlopTypes.NodePlopAPI) {
  plop.setGenerator('docker', {
    description: 'Dockerfile generator',
    actions: [
      {
        type: 'modify',
        path: 'apps/web/next.config.mjs',
        transform(content) {
          // Check if the output is already set to standalone
          if (content.includes('output: "standalone"')) {
            return content;
          }

          return content.replace(
            'const config = {',
            'const config = { output: "standalone",',
          );
        },
      },
      {
        type: 'modify',
        path: 'apps/web/package.json',
        transform(content) {
          const pkg = JSON.parse(content);
          const deps = getDeps();

          if (deps.length === 0) {
            return content;
          }

          for (const dep of deps) {
            pkg['devDependencies'][dep] = 'latest';
          }

          return JSON.stringify(pkg, null, 2);
        },
      },
      {
        type: 'add',
        templateFile: 'templates/docker/Dockerfile.hbs',
        path: 'Dockerfile',
      },
      async () => {
        execSync('pnpm i', {
          stdio: 'inherit',
        })

        execSync('pnpm format:fix', {
          stdio: 'inherit',
        });

        return 'Dockerfile generated';
      },
    ],
    prompts: [],
  });
}

function getDeps() {
  const arch = os.arch();

  if (arch === 'arm64') {
    return [
      'lightningcss-linux-arm64-musl',
      '@tailwindcss/oxide-linux-arm64-musl',
    ];
  } else if (arch === 'x64') {
    const isMusl = process.config?.variables?.hasOwnProperty('musl');

    return isMusl
      ? ['lightningcss-linux-x64-musl', '@tailwindcss/oxide-linux-x64-musl']
      : ['lightningcss-linux-x64-gnu', '@tailwindcss/oxide-linux-x64-gnu'];
  } else {
    return [];
  }
}
