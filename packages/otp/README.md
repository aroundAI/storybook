# @kit/otp

One-time password (OTP) and token management system for secure operations like account deletion, sensitive changes, and email verification.

## Purpose

This package provides OTP functionality for:
- Secure verification of sensitive operations
- Email verification with time-limited tokens
- Account deletion confirmation
- Password reset flows
- Two-factor authentication support
- Rate-limited OTP generation and validation

## Installation

```bash
pnpm add @kit/otp
```

## OTP Verification Component

### Basic Usage

```tsx
import { VerifyOtpForm } from '@kit/otp/components/verify-otp-form';

function DeleteAccountPage() {
  return (
    <VerifyOtpForm
      purpose="account-deletion"
      email={user.email}
      onSuccess={(otp) => {
        // OTP verified, proceed with sensitive operation
        deleteAccount(otp);
      }}
      onError={(error) => {
        toast.error('Invalid or expired OTP');
      }}
      CancelButton={
        <Button variant="outline">Cancel</Button>
      }
    />
  );
}
```

### OTP Purposes

```typescript
export enum OtpPurpose {
  ACCOUNT_DELETION = 'account-deletion',
  EMAIL_VERIFICATION = 'email-verification',
  PASSWORD_RESET = 'password-reset',
  SENSITIVE_ACTION = 'sensitive-action',
  TWO_FACTOR_AUTH = 'two-factor-auth',
  TEAM_TRANSFER = 'team-transfer',
  BILLING_CHANGE = 'billing-change'
}
```

## Server API

### Create OTP Token

```typescript
import { createOtpApi } from '@kit/otp/api';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

const adminClient = getSupabaseServerAdminClient();
const api = createOtpApi(adminClient);

// Create OTP for sensitive operation
const { token, expiresAt } = await api.createOtp({
  email: user.email,
  purpose: 'account-deletion',
  expiresInMinutes: 10 // Default: 10 minutes
});

// Send token via email
await sendOtpEmail(user.email, token);
```

### Verify OTP Token

```typescript
// Verify user-submitted OTP
const isValid = await api.verifyOtp({
  email: user.email,
  token: userSubmittedToken,
  purpose: 'account-deletion'
});

if (isValid) {
  // Proceed with sensitive operation
  await performSensitiveOperation();

  // Mark token as used
  await api.markOtpAsUsed(userSubmittedToken);
} else {
  throw new Error('Invalid or expired OTP');
}
```

### Get OTP Status

```typescript
// Check if OTP exists and is valid
const status = await api.getOtpStatus({
  email: user.email,
  purpose: 'email-verification'
});

if (status.exists && !status.expired && !status.used) {
  // Valid OTP exists
}

// Get detailed OTP info
const otpInfo = await api.getOtp(token);
console.log(otpInfo.expiresAt, otpInfo.attempts);
```

## Components

### OTP Input Component

```tsx
import { OtpInput } from '@kit/otp/components/otp-input';

function CustomOtpForm() {
  const [otp, setOtp] = useState('');

  return (
    <OtpInput
      value={otp}
      onChange={setOtp}
      length={6}
      autoFocus
      onComplete={(value) => {
        // Auto-submit when all digits entered
        verifyOtp(value);
      }}
    />
  );
}
```

### OTP Request Form

```tsx
import { OtpRequestForm } from '@kit/otp/components/otp-request-form';

function RequestOtpPage() {
  return (
    <OtpRequestForm
      purpose="password-reset"
      onSuccess={(email) => {
        toast.success(`OTP sent to ${email}`);
        router.push('/verify-otp');
      }}
      submitLabel="Send Reset Code"
    />
  );
}
```

### OTP Timer

```tsx
import { OtpTimer } from '@kit/otp/components/otp-timer';

function OtpVerification() {
  const [canResend, setCanResend] = useState(false);

  return (
    <div>
      <OtpTimer
        duration={60} // 60 seconds
        onComplete={() => setCanResend(true)}
      />
      <Button disabled={!canResend} onClick={resendOtp}>
        Resend Code
      </Button>
    </div>
  );
}
```

## Server Actions

### Send OTP Action

```typescript
import { sendOtpAction } from '@kit/otp/server-actions';

// In your server component or API
await sendOtpAction({
  email: 'user@example.com',
  purpose: 'email-verification',
  metadata: {
    userId: user.id,
    action: 'verify_email'
  }
});
```

### Verify OTP Action

```typescript
import { verifyOtpAction } from '@kit/otp/server-actions';

const result = await verifyOtpAction({
  email: 'user@example.com',
  token: '123456',
  purpose: 'email-verification'
});

if (result.success) {
  // OTP verified successfully
  await markEmailAsVerified(user.id);
}
```

## Rate Limiting

### Implement Rate Limiting

```typescript
import { createOtpRateLimiter } from '@kit/otp/rate-limiter';

const rateLimiter = createOtpRateLimiter({
  maxAttempts: 5,
  windowMinutes: 15,
  blockDurationMinutes: 60
});

// Check rate limit before creating OTP
const canProceed = await rateLimiter.check(email);

if (!canProceed) {
  throw new Error('Too many OTP requests. Please try again later.');
}

// Create OTP
await createOtp(email);

// Record attempt
await rateLimiter.record(email);
```

## Email Templates

### Send OTP Email

```typescript
import { renderOtpEmail } from '@kit/email-templates';
import { getMailer } from '@kit/mailers';

async function sendOtpEmail(email: string, token: string, purpose: string) {
  const mailer = await getMailer();

  const { html, subject } = await renderOtpEmail({
    userDisplayName: email,
    otp: token,
    purpose: getPurposeDescription(purpose),
    expiresIn: '10 minutes',
    productName: 'Your App'
  });

  await mailer.sendEmail({
    to: email,
    from: 'security@yourapp.com',
    subject,
    html
  });
}
```

## Security Features

### Token Generation

```typescript
import { generateSecureToken } from '@kit/otp/utils/generate-token';

// Generate cryptographically secure 6-digit OTP
const numericOtp = generateSecureToken({
  type: 'numeric',
  length: 6
});

// Generate alphanumeric token
const alphanumericToken = generateSecureToken({
  type: 'alphanumeric',
  length: 8
});

// Generate UUID token for URLs
const urlToken = generateSecureToken({
  type: 'uuid'
});
```

### OTP Validation Rules

```typescript
import { OtpValidationSchema } from '@kit/otp/schemas';

// Validate OTP format
const validatedOtp = OtpValidationSchema.parse({
  token: '123456',
  email: 'user@example.com',
  purpose: 'account-deletion'
});

// Custom validation rules
const CustomOtpSchema = z.object({
  token: z.string().regex(/^\d{6}$/, 'OTP must be 6 digits'),
  email: z.string().email(),
  purpose: z.enum(['account-deletion', 'email-verification'])
});
```

## Database Schema

```sql
-- OTP tokens table
CREATE TABLE otp_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  token VARCHAR(255) NOT NULL,
  purpose VARCHAR(50) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMPTZ,
  attempts INT DEFAULT 0,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_otp_email_purpose ON otp_tokens(email, purpose, expires_at);
CREATE UNIQUE INDEX idx_otp_token ON otp_tokens(token) WHERE NOT used;

-- Cleanup old tokens
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS void AS $$
BEGIN
  DELETE FROM otp_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;
```

## Error Handling

```typescript
import { OtpError, OtpErrorCode } from '@kit/otp/errors';

try {
  await verifyOtp(email, token, purpose);
} catch (error) {
  if (error instanceof OtpError) {
    switch (error.code) {
      case OtpErrorCode.EXPIRED:
        toast.error('OTP has expired. Please request a new one.');
        break;
      case OtpErrorCode.INVALID:
        toast.error('Invalid OTP. Please check and try again.');
        break;
      case OtpErrorCode.ALREADY_USED:
        toast.error('This OTP has already been used.');
        break;
      case OtpErrorCode.TOO_MANY_ATTEMPTS:
        toast.error('Too many failed attempts. Please request a new OTP.');
        break;
      default:
        toast.error('OTP verification failed.');
    }
  }
}
```

## Testing

```typescript
import { createMockOtp, mockOtpApi } from '@kit/otp/testing';

describe('OTP Verification', () => {
  it('should verify valid OTP', async () => {
    const mockOtp = createMockOtp({
      token: '123456',
      email: 'test@example.com',
      purpose: 'email-verification'
    });

    const api = mockOtpApi({
      verifyOtp: jest.fn().mockResolvedValue(true)
    });

    const result = await api.verifyOtp(mockOtp);
    expect(result).toBe(true);
  });
});
```

## Best Practices

1. **Always use HTTPS** for OTP forms to prevent interception
2. **Implement rate limiting** to prevent brute force attacks
3. **Use short expiration times** (5-10 minutes for sensitive operations)
4. **Log OTP events** for security auditing
5. **Clear OTP from UI** after submission
6. **Never log actual OTP tokens** in production
7. **Use different purposes** for different operations
8. **Implement attempt limits** (e.g., 3-5 attempts per OTP)
9. **Send OTP via secure channels** (email, SMS)
10. **Consider using TOTP** for recurring 2FA needs

## Package Dependencies

### External
- `@supabase/supabase-js`: Database operations
- `react-hook-form`: Form handling
- `zod`: Schema validation
- `@radix-ui/*`: UI primitives

### Internal
- `@kit/supabase`: Database client
- `@kit/ui`: UI components
- `@kit/shared`: Shared utilities
- `@kit/email-templates`: Email templates
- `@kit/mailers`: Email sending

### Packages that use this:
- [@kit/accounts](../features/accounts)
- [@kit/team-accounts](../features/team-accounts)

## Contributing

When making changes to this package:

1. Ensure OTP generation is cryptographically secure
2. Test rate limiting thoroughly
3. Verify expiration logic works correctly
4. Run `pnpm typecheck` before committing
5. Update OTP purposes as needed

---

*Updated on 9/20/2025*