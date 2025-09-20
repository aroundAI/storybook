# @kit/nodemailer

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/nodemailer` package provides a Nodemailer implementation for the `@kit/mailers` system. Nodemailer is a popular Node.js email sending library that supports various SMTP providers, making it ideal for development environments and custom email server setups.

## Purpose

This package serves as the Nodemailer implementation for email services, providing:
- **Development email testing**: Perfect for local development with services like Mailtrap
- **SMTP flexibility**: Connect to any SMTP server (Gmail, Outlook, custom servers)
- **Cost-effective solution**: Use existing email infrastructure
- **Advanced features**: Support for complex email configurations
- **Offline development**: Test email functionality without external services

## Technology Stack

- **Nodemailer**: Robust Node.js email library
- **TypeScript**: Full type safety
- **Zod**: Schema validation for configuration

## Installation

```bash
pnpm add @kit/nodemailer
```

## Configuration

### Environment Variables

```bash
# .env.local
NODEMAILER_HOST=smtp.gmail.com
NODEMAILER_PORT=587
NODEMAILER_USER=your-email@gmail.com
NODEMAILER_PASSWORD=your-app-password
NODEMAILER_SECURE=false
EMAIL_SENDER=your-email@gmail.com
```

### Common SMTP Configurations

#### Gmail
```bash
NODEMAILER_HOST=smtp.gmail.com
NODEMAILER_PORT=587
NODEMAILER_SECURE=false
NODEMAILER_USER=your-email@gmail.com
NODEMAILER_PASSWORD=your-app-password
```

#### Outlook/Hotmail
```bash
NODEMAILER_HOST=smtp-mail.outlook.com
NODEMAILER_PORT=587
NODEMAILER_SECURE=false
NODEMAILER_USER=your-email@outlook.com
NODEMAILER_PASSWORD=your-password
```

#### Mailtrap (Development)
```bash
NODEMAILER_HOST=smtp.mailtrap.io
NODEMAILER_PORT=2525
NODEMAILER_USER=your-mailtrap-username
NODEMAILER_PASSWORD=your-mailtrap-password
NODEMAILER_SECURE=false
```

#### Custom SMTP Server
```bash
NODEMAILER_HOST=mail.yourdomain.com
NODEMAILER_PORT=465
NODEMAILER_SECURE=true
NODEMAILER_USER=noreply@yourdomain.com
NODEMAILER_PASSWORD=your-smtp-password
```

## Usage

This package is typically used through `@kit/mailers` and not directly:

```typescript
import { getMailer } from '@kit/mailers';

// Automatically uses Nodemailer when NODEMAILER_HOST is set
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
import { createNodemailerMailer } from '@kit/nodemailer';

const mailer = createNodemailerMailer({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password',
  },
});

await mailer.sendEmail({
  to: 'recipient@example.com',
  from: 'sender@gmail.com',
  subject: 'Test Email',
  html: '<p>This is a test email sent via Nodemailer.</p>',
});
```

## Gmail Setup

### App Passwords

1. **Enable 2-Factor Authentication** on your Google account
2. **Generate App Password**:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Select "Mail" and generate password
3. **Use App Password** as `NODEMAILER_PASSWORD`

### OAuth2 (Advanced)

```typescript
import { createNodemailerMailer } from '@kit/nodemailer';

const mailer = createNodemailerMailer({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: 'your-email@gmail.com',
    clientId: 'your-client-id',
    clientSecret: 'your-client-secret',
    refreshToken: 'your-refresh-token',
  },
});
```

## Development Testing

### Mailtrap

[Mailtrap](https://mailtrap.io) is perfect for development email testing:

1. **Sign up** for free Mailtrap account
2. **Create inbox** and get SMTP credentials
3. **Configure** environment variables:

```bash
NODEMAILER_HOST=smtp.mailtrap.io
NODEMAILER_PORT=2525
NODEMAILER_USER=your-mailtrap-user
NODEMAILER_PASSWORD=your-mailtrap-password
```

### MailHog

[MailHog](https://github.com/mailhog/MailHog) for local email testing:

1. **Install MailHog** locally
2. **Run MailHog** server
3. **Configure** to use local MailHog:

```bash
NODEMAILER_HOST=localhost
NODEMAILER_PORT=1025
NODEMAILER_SECURE=false
# No auth required for MailHog
```

## Features

### Advanced Configurations

#### Connection Pooling

```typescript
const mailer = createNodemailerMailer({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  pool: true, // Enable connection pooling
  maxConnections: 5,
  maxMessages: 100,
  auth: {
    user: 'your-email@gmail.com',
    pass: 'your-app-password',
  },
});
```

#### Custom Headers

```typescript
await mailer.sendEmail({
  to: 'user@example.com',
  from: 'noreply@yourdomain.com',
  subject: 'Custom Headers Example',
  html: '<p>Email with custom headers</p>',
  headers: {
    'X-Priority': '1',
    'X-Mailer': 'MyApp',
  },
});
```

#### Attachments

```typescript
await mailer.sendEmail({
  to: 'user@example.com',
  from: 'documents@yourdomain.com',
  subject: 'Document Attached',
  html: '<p>Please find the document attached.</p>',
  attachments: [
    {
      filename: 'document.pdf',
      path: '/path/to/document.pdf',
    },
    {
      filename: 'data.json',
      content: JSON.stringify(data),
      contentType: 'application/json',
    },
  ],
});
```

## Error Handling

```typescript
import { createNodemailerMailer } from '@kit/nodemailer';

try {
  const mailer = createNodemailerMailer();

  await mailer.sendEmail({
    to: 'user@example.com',
    from: 'noreply@yourdomain.com',
    subject: 'Test',
    html: '<p>Test email</p>',
  });

  console.log('Email sent successfully');
} catch (error) {
  if (error.code === 'EAUTH') {
    console.error('Authentication failed - check credentials');
  } else if (error.code === 'ECONNECTION') {
    console.error('Connection failed - check SMTP settings');
  } else if (error.responseCode === 550) {
    console.error('Email rejected by server');
  } else {
    console.error('Failed to send email:', error.message);
  }
}
```

## Security Considerations

### App Passwords vs OAuth2

- **App Passwords**: Simpler setup, good for development
- **OAuth2**: More secure, recommended for production
- **Never use** regular passwords in production

### SMTP Security

```typescript
// Secure configuration example
const mailer = createNodemailerMailer({
  host: 'smtp.yourdomain.com',
  port: 465,
  secure: true, // Use SSL/TLS
  requireTLS: true, // Require TLS
  tls: {
    rejectUnauthorized: true, // Verify certificates
  },
  auth: {
    user: 'noreply@yourdomain.com',
    pass: process.env.SMTP_PASSWORD,
  },
});
```

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/nodemailer lint

# Type check
pnpm --filter @kit/nodemailer typecheck

# Format code
pnpm --filter @kit/nodemailer format
```

## Package Structure

```
packages/mailers/nodemailer/
├── src/
│   ├── nodemailer-mailer.ts    # Nodemailer implementation
│   └── config.ts              # Configuration utilities
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `nodemailer` - Node.js email sending library
- `@types/nodemailer` - TypeScript definitions
- `@kit/mailers-shared` - Shared mailer interfaces
- `zod` - Schema validation

### Used By
- `@kit/mailers` - Main mailers package

## Best Practices

1. **Use App Passwords**: Never use regular passwords for Gmail
2. **Test in development**: Use Mailtrap or MailHog for testing
3. **Enable connection pooling**: For high-volume applications
4. **Handle errors gracefully**: Provide user-friendly error messages
5. **Use TLS/SSL**: Always encrypt email connections
6. **Monitor delivery**: Log email events for debugging

## Troubleshooting

### Common Issues

**Authentication failed:**
- Check username and password
- Enable 2FA and use App Password for Gmail
- Verify account settings allow SMTP access

**Connection timeout:**
- Check SMTP host and port
- Verify firewall/network settings
- Try different ports (25, 465, 587)

**Emails not delivered:**
- Check spam folders
- Verify sender domain reputation
- Use proper SPF/DKIM records

## Contributing

When contributing to this package:

1. **Test with multiple providers**: Gmail, Outlook, custom SMTP
2. **Handle various error scenarios**: Network, auth, delivery failures
3. **Update type definitions**: Keep TypeScript interfaces current
4. **Document configurations**: Clear examples for common providers

---

*Last updated: September 20, 2025*
