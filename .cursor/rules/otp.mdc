---
description: The OTP API provides the ability to perform additional checks before executing sensitive operations
globs: 
alwaysApply: false
---
The OTP API allows the user to:

1. protect sensitive operations behind an additional layer of verification
2. other security operations such as oAuth2 (storing the "state" parameter with additional metadata)

- API: The OTP API [index.ts](mdc:packages/otp/src/api/index.ts) abstract operations with the Database RPCs.
- The Database schema can be found at [12-one-time-tokens.sql](mdc:apps/web/supabase/schemas/12-one-time-tokens.sql)

## Creating an OTP Token
We can se the [verify-otp-form.tsx](mdc:packages/otp/src/components/verify-otp-form.tsx) for creating a quick form to create tokens server side.

```tsx
import { VerifyOtpForm } from '@kit/otp/components';

function MyVerificationPage(props: {
    userEmail: string;
}) {
  return (
    <VerifyOtpForm
      purpose="password-reset"
      email={props.userEmail}
      onSuccess={(otp) => {
        // Handle successful verification
        // Use the OTP for verification on the server
      }}
      CancelButton={
        <Button variant="outline" onClick={handleCancel}>
          Cancel
        </Button>
      }
    />
  );
}
```

## Verifying a Token
And here is the server action that verifies the OTP:

```tsx
// Verify the token
const result = await api.verifyToken({
  token: submittedToken,
  purpose: 'email-verification'
});

if (result.valid) {
  // Token is valid, proceed with the operation
  const { userId, metadata } = result;
  // Handle successful verification
} else {
  // Token is invalid or expired
  // Handle verification failure
}
```