# @kit/auth

Complete authentication system with Supabase Auth for Next.js applications, providing pre-built components and flows for all authentication scenarios.

## Purpose

This package provides a comprehensive authentication solution including:
- Sign-in/Sign-up flows (email/password, OAuth, OTP)
- Password reset and email verification
- Multi-factor authentication (MFA)
- Session management and auth guards
- Social provider authentication
- Captcha integration for security
- Pre-built authentication UI components

## Installation

```bash
pnpm add @kit/auth
```

## Authentication Components

### Sign In Page

```tsx
import { SignInMethodsContainer } from '@kit/auth/sign-in';

export default function SignInPage() {
  return (
    <SignInMethodsContainer
      paths={{
        callback: '/auth/callback',
        returnToPath: '/home'
      }}
    />
  );
}
```

### Sign Up Page

```tsx
import { SignUpMethodsContainer } from '@kit/auth/sign-up';

export default function SignUpPage() {
  return (
    <SignUpMethodsContainer
      paths={{
        callback: '/auth/callback',
        returnToPath: '/home',
        appHome: '/home'
      }}
    />
  );
}
```

### Password Reset

```tsx
import { UpdatePasswordForm } from '@kit/auth/password-reset';

function ResetPasswordPage() {
  return (
    <UpdatePasswordForm
      redirectTo="/auth/sign-in"
    />
  );
}
```

### Email Verification

```tsx
import { VerifyEmailForm } from '@kit/auth/verify-email';

function VerifyEmailPage() {
  return (
    <VerifyEmailForm
      onSuccess={() => {
        // Handle successful verification
      }}
    />
  );
}
```

## Authentication Hooks

### Password Sign Up Flow

```typescript
import { usePasswordSignUpFlow } from '@kit/auth/hooks/use-password-sign-up-flow';

function SignUpComponent() {
  const { signUp, isLoading, error } = usePasswordSignUpFlow({
    onSuccess: (user) => {
      console.log('User signed up:', user);
    },
    onError: (error) => {
      console.error('Sign up failed:', error);
    }
  });

  const handleSignUp = async (email: string, password: string) => {
    await signUp({ email, password });
  };

  return (
    <form onSubmit={handleSignUp}>
      {/* Form fields */}
    </form>
  );
}
```

### Last Auth Method

```typescript
import { useLastAuthMethod } from '@kit/auth/hooks/use-last-auth-method';

function AuthComponent() {
  const lastMethod = useLastAuthMethod();

  // Remembers user's last authentication method
  // Useful for pre-selecting auth method on return visits

  if (lastMethod === 'google') {
    // Show Google sign-in prominently
  }
}
```

## Multi-Factor Authentication (MFA)

### MFA Setup

```tsx
import { MultiFactorAuthSetup } from '@kit/auth/mfa';

function MFASetupPage() {
  return (
    <MultiFactorAuthSetup
      onComplete={() => {
        // MFA setup complete
      }}
    />
  );
}
```

### MFA Verification

```tsx
import { VerifyMFAForm } from '@kit/auth/mfa';

function MFAVerificationPage() {
  return (
    <VerifyMFAForm
      factorId={factorId}
      onSuccess={() => {
        redirect('/dashboard');
      }}
    />
  );
}
```

## Social Authentication

### OAuth Provider Sign In

```tsx
import { OAuthProviderButton } from '@kit/auth/components';

function SocialLogin() {
  return (
    <>
      <OAuthProviderButton
        provider="google"
        redirectTo="/home"
      >
        Sign in with Google
      </OAuthProviderButton>

      <OAuthProviderButton
        provider="github"
        redirectTo="/home"
      >
        Sign in with GitHub
      </OAuthProviderButton>
    </>
  );
}
```

### Link/Unlink Providers

```tsx
import { LinkProviderButton, UnlinkProviderButton } from '@kit/auth/components';

function AccountSettings() {
  return (
    <div>
      <LinkProviderButton provider="github">
        Connect GitHub
      </LinkProviderButton>

      <UnlinkProviderButton identityId={identityId}>
        Disconnect
      </UnlinkProviderButton>
    </div>
  );
}
```

## Authentication Guards

### Protected Routes

```tsx
import { AuthGuard } from '@kit/auth/components';

// Protect entire page
function ProtectedPage() {
  return <div>Protected content</div>;
}

export default AuthGuard(ProtectedPage);

// Or use as wrapper
export default function Page() {
  return (
    <AuthGuard fallback="/auth/sign-in">
      <ProtectedContent />
    </AuthGuard>
  );
}
```

### Session Management

```tsx
import { SessionGuard } from '@kit/auth/components';

function App({ children }) {
  return (
    <SessionGuard
      whenUnauthenticated="/auth/sign-in"
      whenUnverified="/auth/verify-email"
    >
      {children}
    </SessionGuard>
  );
}
```

## Email/OTP Sign In

### Magic Link Sign In

```tsx
import { OTPSignInForm } from '@kit/auth/otp';

function MagicLinkSignIn() {
  return (
    <OTPSignInForm
      redirectTo="/home"
      onSuccess={() => {
        toast.success('Check your email for the magic link!');
      }}
    />
  );
}
```

## Captcha Integration

### Protected Forms with Captcha

```tsx
import { withCaptcha } from '@kit/auth/captcha';
import { SignUpForm } from '@kit/auth/sign-up';

// Protect sign up with captcha
const ProtectedSignUp = withCaptcha(SignUpForm);

function SignUpPage() {
  return (
    <ProtectedSignUp
      siteKey={process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY}
    />
  );
}
```

## Authentication Context

### Auth State Provider

```tsx
import { AuthProvider } from '@kit/auth/components';

export function RootLayout({ children }) {
  return (
    <AuthProvider>
      {children}
    </AuthProvider>
  );
}

// Use auth context in components
import { useAuth } from '@kit/auth/hooks';

function UserProfile() {
  const { user, isLoading, signOut } = useAuth();

  if (isLoading) return <Spinner />;
  if (!user) return <SignInPrompt />;

  return (
    <div>
      <p>Welcome {user.email}</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

## Server-Side Authentication

### Verify Auth in Server Components

```typescript
import { requireAuth } from '@kit/auth/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

export default async function ServerPage() {
  const client = getSupabaseServerClient();

  // Throws if not authenticated
  const user = await requireAuth(client);

  return <div>Authenticated as: {user.email}</div>;
}
```

### Check Auth Status

```typescript
import { checkAuth } from '@kit/auth/server';

async function ServerAction() {
  const client = getSupabaseServerClient();
  const { user, session } = await checkAuth(client);

  if (!user) {
    return { error: 'Not authenticated' };
  }

  // Proceed with authenticated action
}
```

## Auth Flows Configuration

### Custom Auth Configuration

```tsx
import { AuthConfig } from '@kit/auth/config';

// Configure auth behavior
export const authConfig: AuthConfig = {
  // Paths
  paths: {
    signIn: '/auth/sign-in',
    signUp: '/auth/sign-up',
    verifyEmail: '/auth/verify',
    callback: '/auth/callback',
    passwordReset: '/auth/reset-password',
    appHome: '/dashboard',
  },

  // Providers
  providers: {
    emailPassword: true,
    magicLink: true,
    oauth: ['google', 'github'],
  },

  // Features
  features: {
    mfa: true,
    emailVerification: 'required', // 'required' | 'optional' | 'disabled'
    captcha: true,
  },

  // Redirects
  redirects: {
    afterSignIn: '/dashboard',
    afterSignUp: '/onboarding',
    afterSignOut: '/',
  },
};
```

## Error Handling

### Auth Error Handling

```typescript
import { handleAuthError } from '@kit/auth/errors';

try {
  await signIn(email, password);
} catch (error) {
  const authError = handleAuthError(error);

  switch (authError.code) {
    case 'invalid_credentials':
      toast.error('Invalid email or password');
      break;
    case 'email_not_verified':
      redirect('/auth/verify-email');
      break;
    case 'mfa_required':
      redirect('/auth/mfa');
      break;
    default:
      toast.error(authError.message);
  }
}
```

## Internationalization

### Translated Auth Components

```tsx
import { Trans } from '@kit/ui/trans';

function SignInForm() {
  return (
    <form>
      <Label>
        <Trans i18nKey="auth:emailLabel" />
      </Label>
      <Input type="email" />

      <Button type="submit">
        <Trans i18nKey="auth:signInButton" />
      </Button>
    </form>
  );
}
```

## Testing

### Mock Authentication

```typescript
import { mockAuth } from '@kit/auth/testing';

describe('Authenticated Component', () => {
  beforeEach(() => {
    mockAuth({
      user: {
        id: '123',
        email: 'test@example.com',
      },
      session: {
        access_token: 'mock-token',
      },
    });
  });

  it('should show authenticated content', () => {
    // Test authenticated behavior
  });
});
```

## Environment Variables

```bash
# Required for authentication
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Optional - for captcha
NEXT_PUBLIC_CAPTCHA_SITE_KEY=your-captcha-site-key
CAPTCHA_SECRET_KEY=your-captcha-secret

# Optional - for OAuth providers
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

## Package Dependencies

### External
- `@supabase/supabase-js`: Supabase authentication
- `react-hook-form`: Form management
- `zod`: Schema validation
- `@radix-ui/*`: UI primitives

### Internal
- `@kit/supabase`: Database and auth client
- `@kit/ui`: UI components
- `@kit/shared`: Shared utilities
- `@kit/i18n`: Internationalization

### Packages that use this:
- [web](../../../apps/web)
- [@kit/next](../../next)

## Contributing

When making changes to this package:

1. Maintain backward compatibility for auth flows
2. Test all authentication methods
3. Update translations for new UI text
4. Run `pnpm typecheck` before committing
5. Document new authentication features

---

*Updated on 9/20/2025*