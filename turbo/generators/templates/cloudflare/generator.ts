import type { PlopTypes } from '@turbo/gen';
import { execSync } from 'node:child_process';

import packageJson from '../../../../package.json';

export function createCloudflareGenerator(plop: PlopTypes.NodePlopAPI) {
  plop.setGenerator('cloudflare', {
    description: 'Cloudflare generator',
    actions: [
      {
        type: 'add',
        templateFile: 'templates/cloudflare/wrangler.jsonc.hbs',
        path: 'apps/web/wrangler.jsonc',
        data: {
          name: packageJson.name,
        },
      },
      {
        type: 'add',
        templateFile: 'templates/cloudflare/open-next.config.ts.hbs',
        path: 'apps/web/open-next.config.ts',
      },
      {
        type: 'add',
        templateFile: 'templates/cloudflare/dev.vars.hbs',
        path: 'apps/web/.dev.vars',
      },
      {
        type: 'modify',
        path: 'apps/web/next.config.mjs',
        async transform(content) {
          content += `
           import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

          void initOpenNextCloudflareForDev();
         `;

          return content;
        },
      },
      {
        type: 'modify',
        path: 'apps/web/package.json',
        async transform(content) {
          const pkg = JSON.parse(content);

          const deps = ['wrangler', '@opennextjs/cloudflare'];

          const getVersion = async (dep: string) => {
            const res = await fetch(
              `https://registry.npmjs.org/-/package/${dep}/dist-tags`,
            );

            const json = await res.json();
            return json.latest;
          };

          for (const dep of deps) {
            const version = await getVersion(dep);
            pkg.devDependencies![dep] = `^${version}`;
          }

          pkg.scripts['preview'] =
            'opennextjs-cloudflare build && opennextjs-cloudflare preview';
          pkg.scripts['deploy'] =
            'opennextjs-cloudflare build && opennextjs-cloudflare deploy';
          pkg.scripts['cf-typegen'] =
            'wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts';

          return JSON.stringify(pkg, null, 2);
        },
      },
      async () => {
        /**
         * Install deps and format everything
         */
        execSync('pnpm i', {
          stdio: 'inherit',
        });

        execSync(
          `pnpm run format:fix`,
        );

        return 'Package scaffolded';
      },
    ],
    prompts: [],
  });
}
