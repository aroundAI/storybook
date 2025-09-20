# @kit/email-templates

Beautiful, responsive email templates built with React Email for transactional emails in your SaaS application.

## Purpose

This package provides:
- Pre-built email templates using React Email
- Responsive, branded email designs
- Internationalization support for email content
- Type-safe template rendering
- Email preview and testing tools
- Consistent email branding across the application

## Installation

```bash
pnpm add @kit/email-templates
```

## Available Templates

### Welcome Email

Sent when a new user signs up or is invited to the platform.

```typescript
import { renderWelcomeEmail } from '@kit/email-templates';

const { html, subject } = await renderWelcomeEmail({
  userDisplayName: 'John Doe',
  loginUrl: 'https://app.com/login',
  productName: 'My SaaS App',
  locale: 'en', // Optional, defaults to 'en'
});

// Use with mailer
await mailer.sendEmail({
  to: 'user@example.com',
  from: 'welcome@yourdomain.com',
  subject,
  html,
});
```

### Password Reset Email

Sent when a user requests to reset their password.

```typescript
import { renderPasswordResetEmail } from '@kit/email-templates';

const { html, subject } = await renderPasswordResetEmail({
  userDisplayName: 'John Doe',
  resetUrl: 'https://app.com/auth/reset?token=xxx',
  productName: 'My SaaS App',
  expiresIn: '1 hour', // Optional
});
```

### OTP Verification Email

Sent for one-time password verification.

```typescript
import { renderOtpEmail } from '@kit/email-templates';

const { html, subject } = await renderOtpEmail({
  userDisplayName: 'John Doe',
  otp: '123456',
  productName: 'My SaaS App',
  expiresIn: '10 minutes',
  purpose: 'Sign in', // Optional context
});
```

### Account Deletion Email

Sent when a user deletes their account.

```typescript
import { renderAccountDeleteEmail } from '@kit/email-templates';

const { html, subject } = await renderAccountDeleteEmail({
  userDisplayName: 'John Doe',
  productName: 'My SaaS App',
  supportEmail: 'support@yourdomain.com',
});
```

### Team Invitation Email

Sent when inviting users to join a team.

```typescript
import { renderInviteEmail } from '@kit/email-templates';

const { html, subject } = await renderInviteEmail({
  inviteeName: 'Jane Smith',
  teamName: 'Acme Corporation',
  inviterName: 'John Doe',
  inviteUrl: 'https://app.com/invites/accept?token=xxx',
  productName: 'My SaaS App',
  role: 'member', // Optional
});
```

### Subscription Email

Sent for subscription-related events.

```typescript
import { renderSubscriptionEmail } from '@kit/email-templates';

const { html, subject } = await renderSubscriptionEmail({
  userDisplayName: 'John Doe',
  productName: 'My SaaS App',
  type: 'upgraded', // 'upgraded' | 'downgraded' | 'cancelled' | 'renewed'
  planName: 'Professional',
  amount: '$99/month',
  nextBillingDate: '2024-02-01',
  manageBillingUrl: 'https://app.com/billing',
});
```

### Payment Failed Email

Sent when a payment fails.

```typescript
import { renderPaymentFailedEmail } from '@kit/email-templates';

const { html, subject } = await renderPaymentFailedEmail({
  userDisplayName: 'John Doe',
  productName: 'My SaaS App',
  amount: '$99.00',
  retryDate: '2024-01-15',
  updatePaymentUrl: 'https://app.com/billing/payment-method',
});
```

### Contact Form Email

Sent when someone submits a contact form.

```typescript
import { renderContactEmail } from '@kit/email-templates';

const { html, subject } = await renderContactEmail({
  name: 'Jane Smith',
  email: 'jane@example.com',
  message: 'I have a question about...',
  productName: 'My SaaS App',
});
```

## Template Components

### Base Layout

All emails use a consistent base layout:

```typescript
import { BaseEmailLayout } from '@kit/email-templates/components';

function CustomEmail({ content }) {
  return (
    <BaseEmailLayout
      productName="My SaaS App"
      logoUrl="https://app.com/logo.png"
      footerText="© 2024 My Company"
    >
      {content}
    </BaseEmailLayout>
  );
}
```

### Common Components

```typescript
import {
  Button,
  Heading,
  Text,
  Link,
  Divider,
  CodeBlock,
} from '@kit/email-templates/components';

// Primary button
<Button href="https://app.com/action">
  Take Action
</Button>

// Heading
<Heading level={2}>Welcome!</Heading>

// Text paragraph
<Text>Your account has been created successfully.</Text>

// Link
<Link href="https://app.com/help">Get Help</Link>

// Divider
<Divider />

// Code block (for OTP, tokens, etc.)
<CodeBlock>ABC123</CodeBlock>
```

## Internationalization

Templates support multiple languages through i18n:

```typescript
import { renderWelcomeEmail } from '@kit/email-templates';

// Render in different languages
const frenchEmail = await renderWelcomeEmail({
  userDisplayName: 'Jean Dupont',
  loginUrl: 'https://app.com/login',
  productName: 'Mon App SaaS',
  locale: 'fr', // French
});

const spanishEmail = await renderWelcomeEmail({
  userDisplayName: 'Juan Pérez',
  loginUrl: 'https://app.com/login',
  productName: 'Mi App SaaS',
  locale: 'es', // Spanish
});
```

### Adding Translations

Email translations are stored in the i18n files:

```json
// locales/en/email.json
{
  "welcome": {
    "subject": "Welcome to {{productName}}!",
    "greeting": "Hi {{name}},",
    "body": "Thanks for signing up! We're excited to have you on board.",
    "cta": "Get Started"
  }
}
```

## Email Preview

### Development Preview

Run the email preview server during development:

```bash
pnpm --filter email-templates dev

# Opens preview at http://localhost:3001
```

### Programmatic Preview

```typescript
import { previewEmail } from '@kit/email-templates/preview';

// Generate preview HTML
const previewHtml = await previewEmail('welcome', {
  userDisplayName: 'John Doe',
  loginUrl: 'https://app.com/login',
  productName: 'My SaaS App',
});

// Open in browser during development
if (process.env.NODE_ENV === 'development') {
  await openInBrowser(previewHtml);
}
```

## Customization

### Brand Colors

Update the color scheme in the base configuration:

```typescript
// src/config/brand.ts
export const brandConfig = {
  colors: {
    primary: '#6366f1',      // Indigo
    secondary: '#8b5cf6',    // Purple
    accent: '#ec4899',       // Pink
    text: '#1f2937',         // Gray 800
    background: '#ffffff',   // White
    border: '#e5e7eb',      // Gray 200
  },
  fonts: {
    heading: 'Inter, sans-serif',
    body: 'Inter, sans-serif',
  },
  logo: {
    url: 'https://yourdomain.com/logo.png',
    width: 150,
    height: 50,
  },
};
```

### Custom Templates

Create your own email templates:

```typescript
import { Html, Body, Container, Text, Button } from '@react-email/components';
import { BaseEmailLayout } from '@kit/email-templates/components';

interface CustomEmailProps {
  userName: string;
  actionUrl: string;
  productName: string;
}

export function CustomEmail({ userName, actionUrl, productName }: CustomEmailProps) {
  return (
    <Html>
      <Body>
        <BaseEmailLayout productName={productName}>
          <Container>
            <Text>Hi {userName},</Text>
            <Text>This is a custom email template.</Text>
            <Button href={actionUrl}>
              Take Action
            </Button>
          </Container>
        </BaseEmailLayout>
      </Body>
    </Html>
  );
}

// Render function
export async function renderCustomEmail(props: CustomEmailProps) {
  const html = await render(CustomEmail(props));
  const subject = `Custom notification from ${props.productName}`;

  return { html, subject };
}
```

## Testing

### Unit Tests

```typescript
import { renderWelcomeEmail } from '@kit/email-templates';

describe('Welcome Email', () => {
  it('should render with correct content', async () => {
    const { html, subject } = await renderWelcomeEmail({
      userDisplayName: 'Test User',
      loginUrl: 'https://test.com/login',
      productName: 'Test App',
    });

    expect(subject).toBe('Welcome to Test App!');
    expect(html).toContain('Test User');
    expect(html).toContain('https://test.com/login');
  });

  it('should render in different languages', async () => {
    const { html, subject } = await renderWelcomeEmail({
      userDisplayName: 'Test User',
      loginUrl: 'https://test.com/login',
      productName: 'Test App',
      locale: 'fr',
    });

    expect(subject).toBe('Bienvenue sur Test App!');
  });
});
```

### Visual Testing

```typescript
import { compareEmails } from '@kit/email-templates/testing';

describe('Email Visual Tests', () => {
  it('should match visual snapshot', async () => {
    const email = await renderWelcomeEmail({
      userDisplayName: 'Test User',
      loginUrl: 'https://test.com',
      productName: 'Test App',
    });

    const matches = await compareEmails(email.html, 'welcome-email');
    expect(matches).toBe(true);
  });
});
```

## Best Practices

1. **Keep emails simple and focused** - One clear call-to-action per email
2. **Test across email clients** - Gmail, Outlook, Apple Mail, etc.
3. **Include plain text versions** - Some clients prefer text-only
4. **Use inline styles** - Better email client compatibility
5. **Optimize images** - Use CDN-hosted images, provide alt text
6. **Make CTAs prominent** - Large, contrasting buttons
7. **Include unsubscribe links** - Required for compliance
8. **Test dark mode** - Many users prefer dark themes

## Email Client Compatibility

Templates are tested with:
- Gmail (Web, iOS, Android)
- Outlook (2016+, Web, iOS, Android)
- Apple Mail (macOS, iOS)
- Yahoo Mail
- Samsung Mail
- Thunderbird

## Troubleshooting

### Common Issues

1. **Images not displaying**
   - Ensure images are hosted on HTTPS
   - Use absolute URLs, not relative paths
   - Provide meaningful alt text

2. **Styles not applying**
   - Use inline styles for best compatibility
   - Avoid complex CSS selectors
   - Test with email preview tools

3. **Links not working**
   - Always use full URLs with protocol
   - Test link tracking if using analytics
   - Avoid JavaScript in links

## Package Dependencies

### External
- `@react-email/components`: React Email component library
- `react`: React library
- `typescript`: TypeScript support

### Internal
- `@kit/i18n`: Internationalization support
- `@kit/shared`: Shared utilities

### Packages that use this:
- [dev-tool](../../apps/dev-tool)
- [web](../../apps/web)
- [@kit/accounts](../features/accounts)
- [@kit/team-accounts](../features/team-accounts)
- [@kit/otp](../otp)

## Contributing

When making changes to this package:

1. Test emails in multiple clients
2. Ensure responsive design works
3. Update translations for all languages
4. Run `pnpm typecheck` before committing
5. Preview changes with the dev server

---

*Updated on 9/20/2025*