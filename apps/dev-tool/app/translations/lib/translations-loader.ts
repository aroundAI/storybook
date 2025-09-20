import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type TranslationData = {
  [key: string]: string | TranslationData;
};

export type Translations = {
  [locale: string]: {
    [namespace: string]: TranslationData;
  };
};

export async function loadTranslations() {
  const localesPath = join(process.cwd(), '../web/public/locales');
  const locales = readdirSync(localesPath);
  const translations: Translations = {};

  for (const locale of locales) {
    translations[locale] = {};

    const namespaces = readdirSync(join(localesPath, locale)).filter((file) =>
      file.endsWith('.json'),
    );

    for (const namespace of namespaces) {
      const namespaceName = namespace.replace('.json', '');

      try {
        const filePath = join(localesPath, locale, namespace);
        const content = readFileSync(filePath, 'utf8');

        translations[locale][namespaceName] = JSON.parse(content);
      } catch (error) {
        console.warn(
          `Warning: Translation file not found for locale "${locale}" and namespace "${namespaceName}"`,
        );

        translations[locale][namespaceName] = {};
      }
    }
  }

  return translations;
}
