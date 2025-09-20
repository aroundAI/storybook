---
description: I18n and Translations
globs: 
alwaysApply: false
---
# i18n System Guide

This document provides a comprehensive overview of the internationalization (i18n) system in our Next.js application.

## Architecture Overview

The i18n system consists of:

1. **Core i18n Package**: Located in `packages/i18n`, providing the foundation for i18n functionality
2. **Application-specific Implementation**: Located in `apps/web/lib/i18n`, customizing the core functionality
3. **Translation Files**: Located in `apps/web/public/locales/[language]/[namespace].json`

## Usage Guide

### 1. Setting Up a Page or Layout with i18n

Wrap your page or layout component with the `withI18n` HOC:

```typescript
import { withI18n } from '~/lib/i18n/with-i18n';

function HomePage() {
  // Your component code
}

export default withI18n(HomePage);
```

### 2. Using Translations in Client Components

Use the `useTranslation` hook from react-i18next:

```tsx
'use client';

import { useTranslation } from 'react-i18next';

export function MyComponent() {
  const { t } = useTranslation('common');
  
  return <h1>{t('homeTabLabel')}</h1>;
}
```

### 3. Using Translations with the Trans Component

For complex translations that include HTML or variables:

```tsx
import { Trans } from '@kit/ui/trans';

export function MyComponent() {
  return (
    <div>
      <Trans 
        i18nKey="teams:inviteAlertBody" 
        values={{ accountName: 'My Team' }}
      />
    </div>
  );
}
```

### 4. Adding Language Selection to Your UI

Use the `LanguageSelector` component:

```tsx
import { LanguageSelector } from '@kit/ui/language-selector';

export function SettingsPage() {
  return (
    <div>
      <h2>Language Settings</h2>
      <LanguageSelector />
    </div>
  );
}
```

### 5. Adding New Translations

1. Create or update JSON files in `apps/web/public/locales/[language]/[namespace].json`
2. Follow the existing structure, adding your new keys

For example, in `apps/web/public/locales/en/common.json`:
```json
{
  "existingKey": "Existing translation",
  "newKey": "New translation text"
}
```

### 6. Adding a New Language

1. Add the language code to the `languages` array in `i18n.settings.ts`
2. Create corresponding translation files in `apps/web/public/locales/[new-language]/`
3. Copy the structure from the English files as a template

### 7. Adding a New Namespace

1. Add the namespace to `defaultI18nNamespaces` in `i18n.settings.ts`
2. Create corresponding translation files for all supported languages

## Advanced Usage

### Dynamic Namespace Loading

When you need translations from namespaces not included in the default set:

```typescript
import { getI18nSettings } from '~/lib/i18n/i18n.settings';

// Load specific namespaces
const settings = getI18nSettings(language, ['specific-namespace']);
```

### Language Priority

The system uses the following priority to determine the language:
1. User-selected language (from cookie)
2. Browser language (if priority is set to 'user')
3. Default language from environment variable

### Common Issues

- **Translation not showing**: Check that you're using the correct namespace
- **Dynamic content not interpolated**: Make sure to use the `values` prop with `Trans` component

## Available Namespaces and Keys

Here's a brief overview of the available namespaces:

- **common**: General UI elements, navigation, errors [common.json](mdc:apps/web/public/locales/en/common.json)
- **auth**: Authentication-related text [auth.json](mdc:apps/web/public/locales/en/auth.json)
- **account**: Account settings and profile [account.json](mdc:apps/web/public/locales/en/account.json)
- **teams**: Team management [teams.json](mdc:apps/web/public/locales/en/teams.json)
- **billing**: Subscription and payment [billing.json](mdc:apps/web/public/locales/en/billing.json)
- **marketing**: Landing pages, blog, etc. [marketing.json](mdc:apps/web/public/locales/en/marketing.json)

When creating a new functionality, it can be useful to add a new namespace.