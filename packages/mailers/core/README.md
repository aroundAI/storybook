# @kit/mailers

Email service abstraction layer supporting multiple providers (Resend and Nodemailer) for sending transactional emails in the application.

## Purpose

This package provides a unified email sending interface that:
- Abstracts email provider implementation details
- Supports both Resend (production) and Nodemailer (development)
- Integrates with email templates from `@kit/email-templates`
- Provides type-safe email sending with validation
- Handles email configuration and provider selection

## Installation

```bash
pnpm add @kit/mailers
```

## Basic Usage

### Simple Email

```typescript
import { getMailer } from '@kit/mailers';

async function sendWelcomeEmail(userEmail: string) {
  // Get mailer instance
  const mailer = await getMailer();

  // Send simple email
  await mailer.sendEmail({
    to: userEmail,
    from: 'welcome@yourdomain.com',
    subject: 'Welcome to Our Platform!',
    html: '<h1>Welcome!</h1><p>Thank you for joining us.</p>',
  });
}
```

### With Email Templates

```typescript
import { getMailer } from '@kit/mailers';
import { renderWelcomeEmail } from '@kit/email-templates';

async function sendTemplatedEmail(user: User) {
  const mailer = await getMailer();

  // Render email template
  const { html, subject } = await renderWelcomeEmail({
    userDisplayName: user.name || user.email,
    loginUrl: `${process.env.NEXT_PUBLIC_APP_URL}/auth/sign-in`,
    productName: 'Your SaaS App',
  });

  // Send rendered email
  await mailer.sendEmail({
    to: user.email,
    from: 'noreply@yourdomain.com',
    subject,
    html,
  });
}
```

## Email Templates Integration

### Available Templates

```typescript
import {
  renderWelcomeEmail,
  renderPasswordResetEmail,
  renderAccountDeleteEmail,
  renderInviteEmail,
  renderOtpEmail,
  renderSubscriptionEmail,
} from '@kit/email-templates';

// Welcome email
const welcome = await renderWelcomeEmail({
  userDisplayName: 'John Doe',
  loginUrl: 'https://app.com/login',
  productName: 'My SaaS',
});

// Password reset
const passwordReset = await renderPasswordResetEmail({
  userDisplayName: 'John Doe',
  resetUrl: 'https://app.com/reset?token=xxx',
  productName: 'My SaaS',
});

// OTP verification
const otp = await renderOtpEmail({
  userDisplayName: 'John Doe',
  otp: '123456',
  productName: 'My SaaS',
  expiresIn: '10 minutes',
});
```

## Provider Configuration

### Resend (Production)

```typescript
// Automatically selected when RESEND_API_KEY is set
// .env.local
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_SENDER=noreply@yourdomain.com
```

### Nodemailer (Development)

```typescript
// Automatically selected when NODEMAILER_HOST is set
// .env.local
NODEMAILER_HOST=smtp.gmail.com
NODEMAILER_PORT=587
NODEMAILER_USER=your-email@gmail.com
NODEMAILER_PASSWORD=your-app-password
NODEMAILER_SECURE=false
EMAIL_SENDER=your-email@gmail.com
```

## Advanced Usage

### Bulk Emails

```typescript
import { getMailer } from '@kit/mailers';

async function sendBulkEmails(recipients: string[]) {
  const mailer = await getMailer();

  // Send to multiple recipients
  await mailer.sendEmail({
    to: recipients, // Array of email addresses
    from: 'newsletter@yourdomain.com',
    subject: 'Monthly Newsletter',
    html: newsletterHtml,
  });
}
```

### With Attachments

```typescript
import { getMailer } from '@kit/mailers';

async function sendWithAttachment() {
  const mailer = await getMailer();

  await mailer.sendEmail({
    to: 'user@example.com',
    from: 'invoices@yourdomain.com',
    subject: 'Your Invoice',
    html: '<p>Please find your invoice attached.</p>',
    attachments: [
      {
        filename: 'invoice.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}
```

### CC and BCC

```typescript
await mailer.sendEmail({
  to: 'primary@example.com',
  cc: ['manager@example.com'],
  bcc: ['archive@yourdomain.com'],
  from: 'system@yourdomain.com',
  subject: 'Important Update',
  html: emailContent,
});
```

## Email Validation

The package includes built-in validation using Zod:

```typescript
const emailSchema = {
  to: z.union([z.string().email(), z.array(z.string().email())]),
  from: z.string().email(),
  subject: z.string().min(1),
  html: z.string(),
  text: z.string().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
};
```

## Common Email Patterns

### User Onboarding

```typescript
async function onboardUser(user: User) {
  const mailer = await getMailer();

  // Send welcome email
  const { html, subject } = await renderWelcomeEmail({
    userDisplayName: user.name,
    loginUrl: `${APP_URL}/dashboard`,
    productName: 'My SaaS',
  });

  await mailer.sendEmail({
    to: user.email,
    from: 'welcome@yourdomain.com',
    subject,
    html,
  });

  // Log email sent
  logger.info({
    userId: user.id,
    email: user.email,
    type: 'welcome_email',
  }, 'Welcome email sent');
}
```

### Password Reset Flow

```typescript
async function sendPasswordResetEmail(user: User, token: string) {
  const mailer = await getMailer();

  const resetUrl = `${APP_URL}/auth/reset-password?token=${token}`;

  const { html, subject } = await renderPasswordResetEmail({
    userDisplayName: user.name || user.email,
    resetUrl,
    productName: 'My SaaS',
  });

  await mailer.sendEmail({
    to: user.email,
    from: 'security@yourdomain.com',
    subject,
    html,
  });
}
```

### Team Invitation

```typescript
async function sendTeamInvitation(
  invitee: { email: string; name?: string },
  team: Team,
  inviter: User
) {
  const mailer = await getMailer();

  const { html, subject } = await renderInviteEmail({
    inviteeName: invitee.name || invitee.email,
    teamName: team.name,
    inviterName: inviter.name,
    inviteUrl: `${APP_URL}/invites/accept?token=${inviteToken}`,
    productName: 'My SaaS',
  });

  await mailer.sendEmail({
    to: invitee.email,
    from: 'invitations@yourdomain.com',
    subject,
    html,
  });
}
```

### OTP Verification

```typescript
async function sendOtpEmail(user: User, otp: string) {
  const mailer = await getMailer();

  const { html, subject } = await renderOtpEmail({
    userDisplayName: user.name || user.email,
    otp,
    productName: 'My SaaS',
    expiresIn: '10 minutes',
  });

  await mailer.sendEmail({
    to: user.email,
    from: 'security@yourdomain.com',
    subject,
    html,
  });
}
```

## Error Handling

```typescript
import { getMailer } from '@kit/mailers';
import { getLogger } from '@kit/shared/logger';

async function sendEmailSafely(emailData: EmailData) {
  const logger = await getLogger();
  const mailer = await getMailer();

  try {
    await mailer.sendEmail({
      to: emailData.to,
      from: emailData.from,
      subject: emailData.subject,
      html: emailData.html,
    });

    logger.info({
      to: emailData.to,
      subject: emailData.subject,
    }, 'Email sent successfully');

    return { success: true };
  } catch (error) {
    logger.error({
      error,
      to: emailData.to,
      subject: emailData.subject,
    }, 'Failed to send email');

    // Don't expose email errors to users
    throw new Error('Failed to send email. Please try again later.');
  }
}
```

## Testing

### Mock Mailer for Tests

```typescript
import { createMockMailer } from '@kit/mailers/testing';

describe('Email functionality', () => {
  let mockMailer;

  beforeEach(() => {
    mockMailer = createMockMailer();
  });

  it('should send welcome email', async () => {
    await sendWelcomeEmail('user@example.com');

    expect(mockMailer.sentEmails).toHaveLength(1);
    expect(mockMailer.sentEmails[0].to).toBe('user@example.com');
    expect(mockMailer.sentEmails[0].subject).toContain('Welcome');
  });
});
```

### Development Testing

Use Nodemailer with a service like [Mailtrap](https://mailtrap.io) or [MailHog](https://github.com/mailhog/MailHog):

```bash
# .env.local for development
NODEMAILER_HOST=smtp.mailtrap.io
NODEMAILER_PORT=2525
NODEMAILER_USER=your-mailtrap-user
NODEMAILER_PASSWORD=your-mailtrap-password
EMAIL_SENDER=test@example.com
```

## Environment Variables

```bash
# Production (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_SENDER=noreply@yourdomain.com

# Development (Nodemailer)
NODEMAILER_HOST=smtp.gmail.com
NODEMAILER_PORT=587
NODEMAILER_USER=your-email@gmail.com
NODEMAILER_PASSWORD=your-app-password
NODEMAILER_SECURE=false
EMAIL_SENDER=your-email@gmail.com

# Optional
EMAIL_REPLY_TO=support@yourdomain.com
```

## Best Practices

1. **Always use templates** for consistent branding
2. **Handle errors gracefully** - email failures shouldn't break user flows
3. **Log email events** for debugging and audit trails
4. **Use appropriate from addresses** (noreply@, support@, etc.)
5. **Test with real email providers** in staging
6. **Implement rate limiting** for email-heavy operations
7. **Use BCC for bulk emails** to protect recipient privacy

## Package Dependencies

### External
- `resend`: Resend email service SDK
- `nodemailer`: Node.js email sending library
- `zod`: Schema validation

### Internal
- `@kit/email-templates`: Email template rendering
- `@kit/shared`: Shared utilities and logger

### Packages that use this:
- [web](../../../apps/web)
- [@kit/accounts](../../features/accounts)
- [@kit/team-accounts](../../features/team-accounts)
- [@kit/otp](../../otp)

## Contributing

When making changes to this package:

1. Test with both Resend and Nodemailer providers
2. Ensure email validation works correctly
3. Update email templates if changing data structures
4. Run `pnpm typecheck` before committing
5. Document new email types or patterns

---

*Updated on 9/20/2025*