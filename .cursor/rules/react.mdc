---
description: 
globs: *.tsx
alwaysApply: false
---
# React

## Core Principles

- **Component-Driven Development**: Build applications as a composition of isolated, reusable components
- **One-Way Data Flow**: Follow React's unidirectional data flow pattern
- **Single Responsibility**: Each component should have a clear, singular purpose
- **TypeScript First**: Use TypeScript for type safety and better developer experience
- **Internationalization (i18n) By Default**: All user-facing text should be translatable

## React Components

### Component Structure

- Always use functional components with TypeScript
- Name components using PascalCase (e.g., `UserProfile`)
- Use named exports for components, not default exports
- Split components by responsibility and avoid "god components"
- Name files to match their component name (e.g., `user-profile.tsx`)

### Props

- Always type props using TypeScript interfaces or type aliases
- Use discriminated unions for complex prop types with conditional rendering
- Destructure props at the start of component functions
- Use prop spreading cautiously and only when appropriate
- Provide default props for optional parameters when it makes sense

```typescript
type ButtonProps = {
  variant: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
};

function Button({ 
  variant, 
  size = 'md', 
  children, 
  disabled = false, 
  onClick 
}: ButtonProps) {
  // Component implementation
}
```

### State Management

- Keep state as local as possible
- Lift state up when multiple components need access
- Use Context sparingly and only for truly global state
- Prefer the "Container/Presenter" pattern when separating data and UI

```typescript
// Container component (manages data)
function UserProfileContainer() {
  const userData = useUserData();
  
  if (userData.isLoading) {
    return <LoadingSpinner />;
  }

  if (userData.error) {
    return <ErrorMessage error={userData.error} />;
  }
  
  return <UserProfilePresenter data={userData.data} />;
}

// Presenter component (renders UI)
function UserProfilePresenter({ data }: { data: UserData }) {
  return (
    <div>
      <h1>{data.name}</h1>
      {/* Rest of the UI */}
    </div>
  );
}
```

### Hooks

- Follow the Rules of Hooks (only call hooks at the top level, only call them from React functions)
- Create custom hooks for reusable logic
- Keep custom hooks focused on a single concern
- Name custom hooks with a 'use' prefix (e.g., `useUserProfile`)
- Extract complex effect logic into separate functions
- Always provide a complete dependencies array to `useEffect`

### Performance Optimization

- Apply `useMemo` for expensive calculations
- Use `useCallback` for functions passed as props to child components
- Split code using dynamic imports and `React.lazy()`

```typescript
const MemoizedComponent = React.memo(function Component(props: Props) {
  // Component implementation
});

// For expensive calculations
const memoizedValue = useMemo(() => computeExpensiveValue(a, b), [a, b]);

// For callback functions passed as props
const memoizedCallback = useCallback(() => {
  doSomething(a, b);
}, [a, b]);
```

### Internationalization (i18n)

- Always use the `Trans` component for text rendering (no hardcoded strings)
- Ensure all i18n keys are available in locale files
- Use namespaces to organize translations logically
- Include interpolation variables in translation keys
- Test UI with different languages, especially those with longer text

```typescript
// Correct
<Trans i18nKey="user:profile.welcomeMessage" values={{ name: user.name }} />

// Incorrect
<p>Welcome, {user.name}!</p>
```

## Server Components

### Fundamentals

- Server Components render React server-side and never run on the client
- Use Server Components as the default choice, especially for data fetching
- No use of hooks, browser APIs, or event handlers in Server Components
- No use of `useState`, `useEffect`, or any other React hooks
- Server Components can render Client Components but not vice versa

### Data Fetching

- Fetch data directly using async/await in Server Components
- Use Suspense boundaries around data-fetching components
- Apply security checks before fetching sensitive data
- Never pass sensitive data (API keys, tokens) to Client Components
- Use React's `cache()` function for caching data requests

### Error Handling

- Implement error boundaries at appropriate levels
- Use the Next.js `error.tsx` file for route-level error handling
- Create fallback UI for when data fetching fails
- Log server errors appropriately without exposing details to clients

### Streaming and Suspense

- Use React Suspense for progressive loading experiences if specified
- Implement streaming rendering for large or complex pages
- Structure components to enable meaningful loading states
- Prioritize above-the-fold content when using streaming

## Client Components

### Fundamentals

- Add the `'use client'` directive at the top of files for Client Components
- Keep Client Components focused on interactivity and browser APIs
- Use hooks appropriately following the Rules of Hooks
- Implement controlled components for form elements
- Handle all browser events in Client Components

### Data Fetching

- Use React Query (TanStack Query) for data fetching in Client Components
- Create custom hooks for data fetching logic (e.g., `useUserData`)
- Always handle loading, success, and error states

### Form Handling

- Use libraries like React Hook Form for complex forms
- Implement proper validation with libraries like Zod
- Create reusable form components
- Handle form submissions with loading and error states
- Use controlled components for form inputs

### Error Handling

- Implement error boundaries to catch and handle component errors if using client components
- Always handle network request errors
- Provide user-friendly error messages
- Log errors appropriately
- Implement retry mechanisms where applicable

```typescript
'use client';

import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

export function UserProfileWithErrorHandling() {
  return (
    <ErrorBoundary
      FallbackComponent={ErrorFallback}
      onReset={() => {
        // Reset application state here if needed
      }}
    >
      <UserProfile userId="123" />
    </ErrorBoundary>
  );
}
```
