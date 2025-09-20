import type { PlopTypes } from '@turbo/gen';

import { createCloudflareGenerator } from './templates/cloudflare/generator';
import { createDockerGenerator } from './templates/docker/generator';
import { createEnvironmentVariablesGenerator } from './templates/env/generator';
import { createKeystaticAdminGenerator } from './templates/keystatic/generator';
import { createPackageGenerator } from './templates/package/generator';
import { createSetupGenerator } from './templates/setup/generator';
import { createEnvironmentVariablesValidatorGenerator } from './templates/validate-env/generator';

// List of generators to be registered
const generators = [
  createPackageGenerator,
  createKeystaticAdminGenerator,
  createEnvironmentVariablesGenerator,
  createEnvironmentVariablesValidatorGenerator,
  createSetupGenerator,
  createCloudflareGenerator,
  createDockerGenerator,
];

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  generators.forEach((gen) => gen(plop));
}
