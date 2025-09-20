# @kit/resend

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/resend` package provides a Resend email provider implementation for the `@kit/mailers` system. Resend is a modern email service designed for developers, offering reliable transactional email delivery with a simple API.

## Purpose

This package serves as the Resend implementation for email services, providing:
- **Production email delivery**: Reliable transactional email service
- **Simple API integration**: Clean integration with Resend's REST API
- **High deliverability**: Optimized for inbox delivery rates
- **Scalable sending**: Handle high-volume email operations
- **Webhook support**: Email event tracking and monitoring

## Technology Stack

- **Resend SDK**: Official Resend JavaScript SDK
- **TypeScript**: Full type safety
- **Zod**: Schema validation for email data

## Installation

```bash
pnpm add @kit/resend
```

## Configuration

### Environment Variables

```bash
# .env.local
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_SENDER=noreply@yourdomain.com
```

### Getting Resend API Key

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain or use Resend's sandbox domain
3. Generate an API key in the dashboard
4. Add the API key to your environment variables

## Usage

This package is typically used through `@kit/mailers` and not directly:

```typescript
import { getMailer } from '@kit/mailers';

// Automatically uses Resend when RESEND_API_KEY is set
const mailer = await getMailer();

await mailer.sendEmail({
  to: 'user@example.com',
  from: 'noreply@yourdomain.com',
  subject: 'Welcome!',
  html: '<h1>Welcome to our platform!</h1>',
});
```

### Direct Usage

```typescript
import { createResendMailer } from '@kit/resend';

const mailer = createResendMailer();

await mailer.sendEmail({
  to: 'recipient@example.com',
  from: 'sender@yourdomain.com',
  subject: 'Test Email',
  html: '<p>This is a test email sent via Resend.</p>',
});
```

## Features

### Supported Email Types

- **Single recipient**: Send to one email address
- **Multiple recipients**: Send to multiple addresses (up to 50)
- **HTML and text content**: Rich HTML emails with optional text fallback
- **Attachments**: File attachments support
- **Custom headers**: Add custom email headers
- **Tags**: Organize emails with tags

### Example with Attachments

```typescript
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
```

### Email Tags

```typescript
await mailer.sendEmail({
  to: 'user@example.com',
  from: 'newsletter@yourdomain.com',
  subject: 'Monthly Newsletter',
  html: newsletterContent,
  tags: [
    { name: 'category', value: 'newsletter' },
    { name: 'month', value: '2025-09' },
  ],
});
```

## Domain Setup

### Custom Domain

1. **Add domain** in Resend dashboard
2. **Configure DNS records**:
   - SPF: `v=spf1 include:_spf.resend.com ~all`
   - DKIM: Add provided DKIM record
   - DMARC: `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`

3. **Verify domain** in Resend dashboard

### Sandbox Domain

For testing, you can use Resend's sandbox domain:
- Emails sent to your own verified email addresses
- No domain setup required
- Limited to development use

## Error Handling

```typescript
import { createResendMailer } from '@kit/resend';

try {
  const mailer = createResendMailer();

  await mailer.sendEmail({
    to: 'user@example.com',
    from: 'noreply@yourdomain.com',
    subject: 'Test',
    html: '<p>Test email</p>',
  });

  console.log('Email sent successfully');
} catch (error) {
  if (error.name === 'validation_error') {
    console.error('Invalid email data:', error.message);
  } else if (error.name === 'rate_limit_exceeded') {
    console.error('Rate limit exceeded, try again later');
  } else {
    console.error('Failed to send email:', error.message);
  }
}
```

## Rate Limits

Resend has built-in rate limiting:
- **Free plan**: 100 emails/day
- **Paid plans**: Higher limits based on plan
- **Burst capacity**: Short-term higher rates allowed

Handle rate limits gracefully in your application:

```typescript
import { createResendMailer } from '@kit/resend';

async function sendEmailWithRetry(emailData: EmailData, maxRetries = 3) {
  const mailer = createResendMailer();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await mailer.sendEmail(emailData);
      return { success: true };
    } catch (error) {
      if (error.name === 'rate_limit_exceeded' && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
}
```

## Webhooks

Set up webhooks to track email events:

1. **Configure webhook URL** in Resend dashboard
2. **Handle webhook events** in your application:

```typescript
// app/api/webhooks/resend/route.ts
export async function POST(request: Request) {
  const event = await request.json();

  switch (event.type) {
    case 'email.sent':
      console.log('Email sent:', event.data.email_id);
      break;
    case 'email.delivered':
      console.log('Email delivered:', event.data.email_id);
      break;
    case 'email.bounced':
      console.log('Email bounced:', event.data.email_id);
      break;
    case 'email.complained':
      console.log('Email complained:', event.data.email_id);
      break;
  }

  return Response.json({ received: true });
}
```

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/resend lint

# Type check
pnpm --filter @kit/resend typecheck

# Format code
pnpm --filter @kit/resend format
```

## Package Structure

```
packages/mailers/resend/
├── src/
│   └── resend-mailer.ts    # Resend implementation
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `resend` - Official Resend SDK
- `@kit/mailers-shared` - Shared mailer interfaces
- `zod` - Schema validation

### Used By
- `@kit/mailers` - Main mailers package

## Best Practices

1. **Use verified domains**: Set up proper DNS records for better deliverability
2. **Monitor webhooks**: Track email delivery and engagement
3. **Handle rate limits**: Implement retry logic with exponential backoff
4. **Use appropriate from addresses**: Match your domain and use case
5. **Tag emails**: Organize and track different email types
6. **Test thoroughly**: Test with real email addresses before production

## Contributing

When contributing to this package:

1. **Follow Resend API patterns**: Stay consistent with Resend's conventions
2. **Handle errors properly**: Provide clear error messages and handling
3. **Test with real Resend account**: Verify functionality with actual API
4. **Update error handling**: Account for new Resend error types

---

*Last updated: September 20, 2025*
