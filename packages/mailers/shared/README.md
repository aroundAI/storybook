# @kit/mailers-shared

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/mailers-shared` package provides shared interfaces, types, and utilities for the mailer system. It defines the common contracts that all email providers must implement, ensuring consistency across Resend, Nodemailer, and any future email providers.

## Purpose

This package serves as the foundation for the mailer system, providing:
- **Common interfaces**: Standardized mailer interface for all providers
- **Type definitions**: Shared TypeScript types for email operations
- **Validation schemas**: Zod schemas for email data validation
- **Utility functions**: Helper functions for email processing
- **Error types**: Standardized error handling across providers

## Technology Stack

- **TypeScript**: Pure TypeScript definitions and interfaces
- **Zod**: Schema validation for email data
- **No runtime dependencies**: Types and utilities only

## Installation

```bash
pnpm add @kit/mailers-shared
```

## Core Types

### MailerInterface

The main interface that all email providers must implement:

```typescript
interface Mailer {
  sendEmail(data: EmailData): Promise<void>;
}
```

### EmailData Interface

```typescript
interface EmailData {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
  tags?: EmailTag[];
}
```

### Attachment Interface

```typescript
interface Attachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  path?: string;
  cid?: string;
}
```

### EmailTag Interface

```typescript
interface EmailTag {
  name: string;
  value: string;
}
```

## Validation Schemas

### Email Data Schema

```typescript
import { emailDataSchema } from '@kit/mailers-shared';

const emailData = {
  to: 'user@example.com',
  from: 'noreply@yourdomain.com',
  subject: 'Welcome!',
  html: '<h1>Welcome!</h1>',
};

// Validate email data
const validated = emailDataSchema.parse(emailData);
```

### Attachment Schema

```typescript
import { attachmentSchema } from '@kit/mailers-shared';

const attachment = {
  filename: 'document.pdf',
  content: pdfBuffer,
  contentType: 'application/pdf',
};

const validatedAttachment = attachmentSchema.parse(attachment);
```

## Utility Functions

### Email Validation

```typescript
import { isValidEmail, normalizeEmail } from '@kit/mailers-shared';

// Validate email address
if (isValidEmail('user@example.com')) {
  console.log('Valid email');
}

// Normalize email address
const normalized = normalizeEmail('User@Example.COM'); // 'user@example.com'
```

### Email Processing

```typescript
import { processEmailAddresses, sanitizeHtml } from '@kit/mailers-shared';

// Process recipient addresses
const recipients = processEmailAddresses([
  'user1@example.com',
  'User2@Example.COM',
  'invalid-email',
]);
// Returns: ['user1@example.com', 'user2@example.com']

// Sanitize HTML content
const safeHtml = sanitizeHtml('<script>alert("xss")</script><p>Safe content</p>');
// Returns: '<p>Safe content</p>'
```

## Error Types

### MailerError

```typescript
import { MailerError, EmailValidationError } from '@kit/mailers-shared';

// Base mailer error
throw new MailerError('Failed to send email', {
  provider: 'resend',
  originalError: error,
});

// Email validation error
throw new EmailValidationError('Invalid email address', {
  field: 'to',
  value: 'invalid-email',
});
```

### Error Handling Utilities

```typescript
import { isMailerError, getErrorMessage } from '@kit/mailers-shared';

try {
  await mailer.sendEmail(emailData);
} catch (error) {
  if (isMailerError(error)) {
    console.error('Mailer error:', getErrorMessage(error));
  } else {
    console.error('Unknown error:', error);
  }
}
```

## Provider Implementation

### Creating a Custom Provider

```typescript
import { Mailer, EmailData } from '@kit/mailers-shared';

export class CustomMailer implements Mailer {
  async sendEmail(data: EmailData): Promise<void> {
    // Validate input data
    const validated = emailDataSchema.parse(data);

    // Implement email sending logic
    try {
      await this.sendViaProvider(validated);
    } catch (error) {
      throw new MailerError('Failed to send email', {
        provider: 'custom',
        originalError: error,
      });
    }
  }

  private async sendViaProvider(data: EmailData): Promise<void> {
    // Provider-specific implementation
  }
}
```

### Provider Registration

```typescript
import { registerMailerProvider } from '@kit/mailers-shared';

// Register custom provider
registerMailerProvider('custom', CustomMailer);
```

## Testing Utilities

### Mock Mailer

```typescript
import { createMockMailer } from '@kit/mailers-shared/testing';

const mockMailer = createMockMailer();

// Send email (captured, not actually sent)
await mockMailer.sendEmail({
  to: 'test@example.com',
  from: 'noreply@example.com',
  subject: 'Test',
  html: '<p>Test</p>',
});

// Check sent emails
expect(mockMailer.sentEmails).toHaveLength(1);
expect(mockMailer.sentEmails[0].to).toBe('test@example.com');
```

### Test Helpers

```typescript
import {
  generateTestEmail,
  createValidEmailData,
  expectEmailToBeSent,
} from '@kit/mailers-shared/testing';

// Generate test email data
const testEmail = generateTestEmail({
  to: 'test@example.com',
  subject: 'Test Email',
});

// Create valid email data for testing
const validEmail = createValidEmailData();

// Test assertion helper
await expectEmailToBeSent(mockMailer, {
  to: 'user@example.com',
  subject: 'Welcome',
});
```

## Available Scripts

```bash
# Lint the package
pnpm --filter @kit/mailers-shared lint

# Type check
pnpm --filter @kit/mailers-shared typecheck

# Format code
pnpm --filter @kit/mailers-shared format
```

## Package Structure

```
packages/mailers/shared/
├── src/
│   ├── types/
│   │   ├── mailer.types.ts      # Core mailer interfaces
│   │   ├── email.types.ts       # Email data types
│   │   └── error.types.ts       # Error definitions
│   ├── schemas/
│   │   ├── email.schema.ts      # Zod validation schemas
│   │   └── attachment.schema.ts # Attachment schemas
│   ├── utils/
│   │   ├── validation.ts        # Email validation utilities
│   │   ├── processing.ts        # Email processing helpers
│   │   └── sanitization.ts      # Content sanitization
│   ├── errors/
│   │   └── mailer-errors.ts     # Error classes
│   ├── testing/
│   │   ├── mock-mailer.ts       # Mock mailer for testing
│   │   └── test-helpers.ts      # Testing utilities
│   └── index.ts                 # Package exports
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages
- `zod` - Schema validation
- `@types/node` - Node.js type definitions

### Used By
- `@kit/mailers` - Core mailers package
- `@kit/resend` - Resend email provider
- `@kit/nodemailer` - Nodemailer provider
- Any custom email providers

## Best Practices

1. **Use provided schemas**: Always validate email data using the provided Zod schemas
2. **Handle errors properly**: Use the standardized error types
3. **Sanitize content**: Use sanitization utilities for user-generated content
4. **Validate addresses**: Use email validation utilities before sending
5. **Test thoroughly**: Use the provided testing utilities

## Contributing

When contributing to this package:

1. **Maintain interface compatibility**: Don't break existing interfaces
2. **Add comprehensive tests**: Test all utilities and helpers
3. **Document new features**: Update this README for new functionality
4. **Consider all providers**: Ensure changes work with all email providers
5. **Follow TypeScript best practices**: Use proper type definitions

---

*Last updated: September 20, 2025*
