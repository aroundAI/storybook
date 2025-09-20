# @kit/i18n

Internationalization (i18n) support for the SaaS application, providing multi-language capabilities with i18next integration for both server and client components.

## Purpose

This package provides internationalization features including:
- Server-side translation support for RSC and SSR
- Client-side translation with React hooks
- Language detection from Accept-Language headers
- Namespace-based translation organization
- Dynamic locale switching
- Translation resource management
- Support for interpolation and pluralization

## Installation

```bash
pnpm add @kit/i18n
```

## Server-Side Initialization

### Initialize i18n for Server Components

```typescript
import { initializeServerI18n } from '@kit/i18n/server';
import { createI18nSettings } from '@kit/i18n';

// Create i18n settings
const settings = createI18nSettings({
  languages: ['en', 'es', 'fr', 'de'],
  language: 'en', // Default language
  namespaces: ['common', 'auth', 'dashboard']
});

// Initialize server i18n with resource resolver
const i18n = await initializeServerI18n(
  settings,
  async (language, namespace) => {
    // Load translation files
    return import(`../locales/${language}/${namespace}.json`);
  }
);

// Use in server components
const { t } = await i18n;
const welcomeMessage = t('common:welcome');
```

### Parse Accept-Language Header

```typescript
import { parseAcceptLanguageHeader } from '@kit/i18n/server';

export async function middleware(request: Request) {
  const acceptLanguage = request.headers.get('accept-language');

  // Get user's preferred languages
  const userLanguages = parseAcceptLanguageHeader(
    acceptLanguage,
    ['en', 'es', 'fr', 'de'] // Supported languages
  );

  // Use first preferred language or fallback
  const language = userLanguages[0] || 'en';

  // Set language for the request
  // ...
}
```

## Client-Side Usage

### Initialize Client i18n

```typescript
import { initializeClientI18n } from '@kit/i18n/client';
import { createI18nSettings } from '@kit/i18n';

const settings = createI18nSettings({
  languages: ['en', 'es', 'fr', 'de'],
  language: currentLanguage,
  namespaces: ['common', 'auth', 'dashboard']
});

// Initialize client i18n
await initializeClientI18n(
  settings,
  async (language, namespace) => {
    // Load translations dynamically
    const response = await fetch(`/api/i18n/${language}/${namespace}`);
    return response.json();
  }
);
```

### I18n Provider Component

```tsx
'use client';
import { I18nProvider } from '@kit/i18n/provider';
import { useTranslation } from 'react-i18next';

// Wrap your app with the provider
export function App({ children, language }) {
  return (
    <I18nProvider language={language}>
      {children}
    </I18nProvider>
  );
}

// Use translations in client components
function ClientComponent() {
  const { t, i18n } = useTranslation();

  return (
    <div>
      <h1>{t('common:welcome')}</h1>
      <button onClick={() => i18n.changeLanguage('es')}>
        {t('common:switchToSpanish')}
      </button>
    </div>
  );
}
```

## Configuration

### Creating i18n Settings

```typescript
import { createI18nSettings } from '@kit/i18n';

const settings = createI18nSettings({
  // Supported languages
  languages: ['en', 'es', 'fr', 'de', 'ja'],

  // Current language
  language: 'en',

  // Translation namespaces
  namespaces: [
    'common',      // Shared translations
    'auth',        // Authentication
    'dashboard',   // Dashboard
    'billing',     // Billing
    'settings',    // Settings
    'errors'       // Error messages
  ]
});

// Settings include:
// - supportedLngs: List of supported languages
// - fallbackLng: Fallback language (first in array)
// - lng: Current language
// - ns: Namespaces to load
// - react.useSuspense: Enable React Suspense
```

### Advanced Configuration

```typescript
const settings = createI18nSettings({
  languages: ['en', 'es'],
  language: 'en',
  namespaces: ['common', 'auth']
});

// Customize further
const customSettings = {
  ...settings,

  // Interpolation settings
  interpolation: {
    escapeValue: false, // React already escapes
    format: (value, format, lng) => {
      if (format === 'uppercase') return value.toUpperCase();
      if (format === 'currency') {
        return new Intl.NumberFormat(lng, {
          style: 'currency',
          currency: 'USD'
        }).format(value);
      }
      return value;
    }
  },

  // Debug mode
  debug: process.env.NODE_ENV === 'development',

  // Missing key handler
  missingKeyHandler: (lng, ns, key) => {
    console.warn(`Missing translation: ${lng}/${ns}:${key}`);
  }
};
```

## Translation Files

### File Structure

```
locales/
├── en/
│   ├── common.json
│   ├── auth.json
│   ├── dashboard.json
│   └── errors.json
├── es/
│   ├── common.json
│   ├── auth.json
│   ├── dashboard.json
│   └── errors.json
└── fr/
    └── ...
```

### Translation File Format

```json
// locales/en/common.json
{
  "welcome": "Welcome",
  "greeting": "Hello, {{name}}!",
  "itemCount": "{{count}} item",
  "itemCount_plural": "{{count}} items",
  "save": "Save",
  "cancel": "Cancel",
  "loading": "Loading..."
}

// locales/en/auth.json
{
  "signIn": "Sign In",
  "signUp": "Sign Up",
  "email": "Email",
  "password": "Password",
  "forgotPassword": "Forgot Password?",
  "errors": {
    "invalidCredentials": "Invalid email or password",
    "emailRequired": "Email is required",
    "passwordTooShort": "Password must be at least {{min}} characters"
  }
}
```

## Usage Patterns

### Server Components (RSC)

```tsx
// app/[locale]/page.tsx
import { initializeServerI18n } from '@kit/i18n/server';
import { createI18nSettings } from '@kit/i18n';

export default async function HomePage({ params }) {
  const settings = createI18nSettings({
    languages: ['en', 'es'],
    language: params.locale,
    namespaces: ['common', 'home']
  });

  const i18n = await initializeServerI18n(
    settings,
    (lng, ns) => import(`@/locales/${lng}/${ns}.json`)
  );

  const { t } = i18n;

  return (
    <div>
      <h1>{t('home:title')}</h1>
      <p>{t('home:description')}</p>
      <button>{t('common:getStarted')}</button>
    </div>
  );
}
```

### Client Components

```tsx
'use client';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';

function UserProfile() {
  const { t, i18n } = useTranslation(['profile', 'common']);
  const [name, setName] = useState('John');

  return (
    <div>
      <h2>{t('profile:title')}</h2>
      <p>{t('profile:greeting', { name })}</p>

      <select
        value={i18n.language}
        onChange={(e) => i18n.changeLanguage(e.target.value)}
      >
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
      </select>

      <button>{t('common:save')}</button>
    </div>
  );
}
```

### With Next.js App Router

```tsx
// app/[locale]/layout.tsx
import { I18nProvider } from '@kit/i18n/provider';

export default function LocaleLayout({
  children,
  params: { locale }
}) {
  return (
    <I18nProvider language={locale}>
      {children}
    </I18nProvider>
  );
}

// middleware.ts
import { NextResponse } from 'next/server';
import { parseAcceptLanguageHeader } from '@kit/i18n/server';

const supportedLanguages = ['en', 'es', 'fr'];

export function middleware(request: Request) {
  const pathname = request.nextUrl.pathname;

  // Check if locale is in path
  const pathnameHasLocale = supportedLanguages.some(
    locale => pathname.startsWith(`/${locale}`)
  );

  if (!pathnameHasLocale) {
    // Get user's preferred language
    const acceptLang = request.headers.get('accept-language');
    const languages = parseAcceptLanguageHeader(
      acceptLang,
      supportedLanguages
    );

    const locale = languages[0] || 'en';

    // Redirect to localized path
    return NextResponse.redirect(
      new URL(`/${locale}${pathname}`, request.url)
    );
  }
}
```

## Advanced Features

### Interpolation

```typescript
// Basic interpolation
t('greeting', { name: 'John' }); // "Hello, John!"

// With formatting
t('price', { amount: 99.99, formatParams: { amount: { style: 'currency' } } });

// Nested values
t('user.profile', { user: { name: 'John', role: 'Admin' } });
```

### Pluralization

```typescript
// Automatic pluralization
t('itemCount', { count: 0 }); // "0 items"
t('itemCount', { count: 1 }); // "1 item"
t('itemCount', { count: 5 }); // "5 items"

// Custom plural rules
{
  "messages_zero": "No messages",
  "messages_one": "1 message",
  "messages_other": "{{count}} messages"
}
```

### Namespaces

```typescript
// Load multiple namespaces
const { t } = useTranslation(['common', 'dashboard', 'settings']);

// Use specific namespace
t('common:save');
t('dashboard:metrics.users');
t('settings:profile.title');

// Default namespace
const { t } = useTranslation('common');
t('save'); // Uses common namespace by default
```

### Context-based Translations

```json
{
  "greeting_male": "Welcome, Mr. {{name}}",
  "greeting_female": "Welcome, Ms. {{name}}",
  "greeting_other": "Welcome, {{name}}"
}
```

```typescript
t('greeting', { name: 'Smith', context: 'male' });
// "Welcome, Mr. Smith"
```

## Error Handling

```typescript
import { initializeServerI18n } from '@kit/i18n/server';
import { getLogger } from '@kit/shared/logger';

async function initI18n(locale: string) {
  const logger = await getLogger();

  try {
    const i18n = await initializeServerI18n(
      settings,
      async (language, namespace) => {
        try {
          return await import(`../locales/${language}/${namespace}.json`);
        } catch (error) {
          logger.error(
            { language, namespace, error },
            'Failed to load translation'
          );

          // Return empty object as fallback
          return {};
        }
      }
    );

    return i18n;
  } catch (error) {
    logger.error({ locale, error }, 'Failed to initialize i18n');
    throw error;
  }
}
```

## Testing

```typescript
import { render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

describe('Internationalized Component', () => {
  beforeEach(() => {
    i18n.init({
      lng: 'en',
      resources: {
        en: {
          common: {
            welcome: 'Welcome',
            save: 'Save'
          }
        },
        es: {
          common: {
            welcome: 'Bienvenido',
            save: 'Guardar'
          }
        }
      }
    });
  });

  it('should render in English', () => {
    const { getByText } = render(
      <I18nextProvider i18n={i18n}>
        <MyComponent />
      </I18nextProvider>
    );

    expect(getByText('Welcome')).toBeInTheDocument();
  });

  it('should switch to Spanish', async () => {
    const { getByText, rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MyComponent />
      </I18nextProvider>
    );

    await i18n.changeLanguage('es');
    rerender(
      <I18nextProvider i18n={i18n}>
        <MyComponent />
      </I18nextProvider>
    );

    expect(getByText('Bienvenido')).toBeInTheDocument();
  });
});
```

## Best Practices

1. **Organize translations by feature** - Use namespaces to group related translations
2. **Keep keys consistent** - Use a naming convention like `feature.section.key`
3. **Avoid hardcoding text** - Always use translation keys
4. **Provide fallbacks** - Ensure fallback language has all translations
5. **Use interpolation** - Don't concatenate translated strings
6. **Handle missing translations** - Log warnings in development
7. **Test all languages** - Ensure UI works with different text lengths
8. **Use proper pluralization** - Don't manually handle singular/plural
9. **Cache translations** - Avoid reloading translation files
10. **Document translation keys** - Maintain a glossary of terms

## Package Dependencies

### External
- `i18next`: Core internationalization framework
- `react-i18next`: React bindings for i18next
- `i18next-resources-to-backend`: Dynamic resource loading

### Internal
None - this is a foundational package

### Packages that use this:
- [web](../../apps/web)
- [dev-tool](../../apps/dev-tool)
- [@kit/email-templates](../email-templates)

## Contributing

When making changes to this package:

1. Test with multiple languages and locales
2. Ensure translations are loaded correctly
3. Verify server and client rendering
4. Run `pnpm typecheck` before committing
5. Update translation files as needed

---

*Updated on 9/20/2025*