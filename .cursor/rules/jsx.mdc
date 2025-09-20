---
description: 
globs: *.tsx
alwaysApply: false
---
# JSX Best Practices

This guide outlines our conventions for writing clean, maintainable JSX in React applications.

## Utility Functions

### Class Name Management

When merging complex classes, always use the `cn` utility from `clsx`/`tailwind-merge`:

```tsx
import { cn } from '@kit/ui/utils';

// Simple usage
<button className={cn('btn', className)}>Submit</button>

// Conditional classes
<div className={cn('base-class', {
  'text-lg': isLarge,
  'bg-primary': isPrimary,
  'opacity-50': isDisabled
})}>
  Content
</div>

// Array syntax for dynamic classes
<span className={cn([
  'badge',
  variant === 'success' && 'badge-success',
  variant === 'error' && 'badge-error'
])}>
  {label}
</span>
```

Why use `cn`:
- Handles merging tailwind classes correctly
- Automatically removes duplicate classes
- Resolves conflicting classes by keeping the last one
- Provides type-safety with TypeScript

## Common Patterns

### Conditional Rendering with `If`

Prefer the `If` component to complex ternary operators in JSX:

```tsx
import { If } from '@kit/ui/if';

// Basic usage
<If condition={isLoading}>
  <Spinner />
</If>

// With fallback
<If condition={isLoading} fallback={<Content />}>
  <Spinner />
</If>

// With callback function for condition match
<If condition={user}>
  {(userData) => <UserProfile data={userData} />}
</If>
```

Benefits:
- Improves readability compared to ternary operators
- Type-safe with TypeScript
- Reduces nesting and complexity in JSX

### List Rendering

Consistently use these patterns for list rendering:

```tsx
// Empty state handling, avoid ternaries
{items.length > 0 ? (
  <ul className="list">
    {items.map((item) => (
      <li key={item.id}>{item.name}</li>
    ))}
  </ul>
) : (
  <EmptyState message="No items found" />
)}

// Even better with If component
<If condition={items.length > 0} fallback={
    <EmptyState message="No items found" />
}>
  <ul className="list">
    {items.map((item) => (
      <li key={item.id}>{item.name}</li>
    ))}
  </ul>
</If>
```

### Using Translations

All user-facing text should use the `Trans` component unless specified otherwise:

```tsx
import { Trans } from '@kit/ui/trans';

// Basic usage
<Trans i18nKey="common:welcomeMessage" defaults="Welcome!" />

// With variables
<Trans 
  i18nKey="user:lastLogin" 
  values={{ date: formatDate(lastLogin) }}
  defaults="Last login: {date}" 
/>

// With HTML elements
<Trans 
  i18nKey="terms:agreement" 
  components={{
    TermsLink: <a href="/terms" className="underline" />,
    PrivacyLink: <a href="/privacy" className="underline" />
  }}
  defaults="I agree to the <TermsLink>Terms</TermsLink> and <PrivacyLink>Privacy Policy</PrivacyLink>." 
/>

// Pluralization
<Trans 
  i18nKey="notifications:count" 
  count={notifications.length}
  defaults="{count, plural, =0 {No notifications} one {# notification} other {# notifications}}" 
/>
```

Important rules:
- Always provide a `defaults` prop with the English text as fallback
- Ensure the key exists in the appropriate translation file
- Keep HTML elements minimal in translations

## Error and Loading States

Use consistent patterns for handling loading and error states:

```tsx
// Loading state
<If condition={isLoading}>
  <div className="flex justify-center p-8">
    <Spinner />
  </div>
</If>

// Error state that infer the type of the condition. The type of the variable "err" is now inferred
// Always use this pattern when the value of the condition is used within the body
<If condition={error}>
  {(err) => (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>
        <Trans i18nKey="common:errorTitle" />
      </AlertTitle>

      <AlertDescription>
        {err.message}
      </AlertDescription>
    </Alert>
  )}
</If>

// Empty state
<If condition={items.length === 0}>
  <div className="flex flex-col items-center justify-center p-8 text-center">
    <EmptyIcon className="h-12 w-12 text-muted-foreground" />

    <h3 className="mt-4 text-lg font-medium">
      <Trans i18nKey="common:noData" />
    </h3>

    <p className="text-sm text-muted-foreground">
      <Trans i18nKey="common:noDataDescription" />
    </p>
  </div>
</If>
```

## Testing Attributes

Add consistent data attributes for testing:

```tsx
<button data-test="submit-button">
  Submit
</button>

<div data-test="user-profile" data-user-id={user.id}>
  {/* User profile content */}
</div>

<form data-test="signup-form">
  {/* Form fields */}
</form>
```