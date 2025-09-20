# @kit/ui

Comprehensive UI component library built with Shadcn UI, Radix UI primitives, and Tailwind CSS.

## Purpose

This package provides a consistent design system with reusable React components for the entire application. It includes form components, modals, buttons, cards, tables, and utility components with built-in dark mode support and accessibility features.

## Installation

```bash
pnpm add @kit/ui
```

## Core Components

### Button

```typescript
import { Button } from '@kit/ui/button';

// Basic usage
<Button>Click me</Button>

// Variants
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>

// Loading state
<Button disabled={isPending}>
  {isPending ? (
    <>
      <Spinner className="mr-2 h-4 w-4" />
      Loading...
    </>
  ) : (
    'Submit'
  )}
</Button>
```

### Form Components

```typescript
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Checkbox } from '@kit/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';

// Form with validation
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const FormSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
  notifications: z.boolean(),
});

function MyForm() {
  const form = useForm({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      email: '',
      role: 'user',
      notifications: false,
    }
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* Text Input */}
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="email@example.com" {...field} />
              </FormControl>
              <FormDescription>
                We'll never share your email.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Select */}
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Role</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Checkbox */}
        <FormField
          control={form.control}
          name="notifications"
          render={({ field }) => (
            <FormItem className="flex items-center space-x-2">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <FormLabel>Enable notifications</FormLabel>
            </FormItem>
          )}
        />

        <Button type="submit">Submit</Button>
      </form>
    </Form>
  );
}
```

### Modal/Dialog

```typescript
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@kit/ui/dialog';

<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Are you sure?</DialogTitle>
      <DialogDescription>
        This action cannot be undone.
      </DialogDescription>
    </DialogHeader>
    {/* Dialog content */}
  </DialogContent>
</Dialog>
```

### Cards

```typescript
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@kit/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description goes here</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card content</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

### Tables

```typescript
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Email</TableHead>
      <TableHead>Role</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {users.map((user) => (
      <TableRow key={user.id}>
        <TableCell>{user.name}</TableCell>
        <TableCell>{user.email}</TableCell>
        <TableCell>{user.role}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

### Toast Notifications

```typescript
import { toast } from '@kit/ui/sonner';

// Simple notifications
toast.success('Action completed successfully');
toast.error('Something went wrong');
toast.info('Information message');
toast.warning('Warning message');

// Promise-based toast
await toast.promise(
  saveSettings(),
  {
    loading: 'Saving settings...',
    success: 'Settings saved!',
    error: 'Failed to save settings',
  }
);

// Custom toast
toast.custom((t) => (
  <div>
    Custom toast content
    <Button onClick={() => toast.dismiss(t)}>Dismiss</Button>
  </div>
));
```

### Alerts

```typescript
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';

<Alert variant="destructive">
  <ExclamationTriangleIcon className="h-4 w-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>
    There was a problem with your request.
  </AlertDescription>
</Alert>
```

## Utility Components

### Loading Spinner

```typescript
import { Spinner } from '@kit/ui/spinner';

<Spinner className="h-6 w-6" />
```

### Conditional Rendering (If)

```typescript
import { If } from '@kit/ui/if';

// Basic usage
<If condition={isLoading} fallback={<Content />}>
  <Spinner />
</If>

// With type inference
<If condition={error}>
  {(err) => <ErrorMessage error={err} />}
</If>
```

### Internationalization (Trans)

```typescript
import { Trans } from '@kit/ui/trans';

// Simple translation
<Trans i18nKey="common:welcome" />

// With interpolation
<Trans
  i18nKey="user:greeting"
  values={{ name: user.name }}
/>

// With components
<Trans
  i18nKey="terms:agreement"
  components={{
    link: <a href="/terms" className="underline" />
  }}
/>
```

### Profile Avatar

```typescript
import { ProfileAvatar } from '@kit/ui/profile-avatar';

<ProfileAvatar
  user={{
    pictureUrl: user.avatar,
    displayName: user.name,
  }}
  size="lg"
/>
```

## Utilities

### Class Name Merging (cn)

```typescript
import { cn } from '@kit/ui/cn';

function MyComponent({ className, variant }) {
  return (
    <div
      className={cn(
        'base-classes',
        variant === 'primary' && 'primary-classes',
        className
      )}
    >
      Content
    </div>
  );
}
```

### Class Variance Authority (cva)

```typescript
import { cva } from '@kit/ui/cva';

const buttonVariants = cva(
  'inline-flex items-center justify-center',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

## Dark Mode Support

All components automatically support dark mode through CSS variables. Use semantic color classes:

```typescript
// ✅ Good - semantic colors
<div className="bg-background text-foreground border-border">
  <p className="text-muted-foreground">Secondary text</p>
</div>

// ❌ Avoid - hardcoded colors
<div className="bg-white text-black border-gray-200">
  <p className="text-gray-500">Secondary text</p>
</div>
```

## Form Validation Best Practices

```typescript
// 1. Define schema in a separate file for reusability
export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().optional(),
});

// 2. Use with React Hook Form (no generics needed)
const form = useForm({
  resolver: zodResolver(CreateProjectSchema),
  defaultValues: {
    name: '',
    description: '',
  }
});

// 3. Handle submission
const onSubmit = async (data) => {
  try {
    await createProject(data);
    toast.success('Project created!');
  } catch (error) {
    toast.error('Failed to create project');
  }
};
```

## Accessibility

All components follow WCAG 2.1 AA guidelines:
- Proper ARIA labels and descriptions
- Keyboard navigation support
- Focus management
- Screen reader compatibility

```typescript
<Button
  aria-label="Delete item"
  aria-describedby="delete-warning"
>
  <TrashIcon className="h-4 w-4" />
</Button>
```

## Testing Attributes

Add `data-test` attributes for E2E testing:

```typescript
<Button data-test="submit-button">Submit</Button>
<Input data-test="email-input" />
<div data-test="user-profile" data-user-id={user.id}>
  Profile
</div>
```

## Component Exports

The package exports components organized by category:

- **Forms**: Form, Input, Select, Checkbox, RadioGroup, Switch, Textarea, DatePicker
- **Feedback**: Alert, Toast, Badge, Progress, Skeleton
- **Overlay**: Dialog, Sheet, Popover, Tooltip, DropdownMenu, ContextMenu
- **Navigation**: Tabs, NavigationMenu, Breadcrumb, Pagination
- **Data Display**: Table, Card, Avatar, AspectRatio
- **Layout**: Container, Separator, ScrollArea
- **Typography**: Heading, Text (styled components)
- **Utilities**: If, Trans, cn, cva, ProfileAvatar, LoadingSpinner

## Dependencies

- **Radix UI**: Unstyled, accessible component primitives
- **Tailwind CSS**: Utility-first CSS framework
- **class-variance-authority**: Variant styling utilities
- **tailwind-merge**: Intelligent class merging
- **React Hook Form**: Form state management
- **Zod**: Schema validation
```
Checks code for style and potential errors

### `typecheck`
```bash
pnpm --filter ui typecheck
```
Verifies TypeScript type correctness

## Available Hooks

### `useIsMobile`
```typescript
import { useIsMobile } from '@kit/ui/hooks';
```

### `useSupabaseUpload`
```typescript
import { useSupabaseUpload } from '@kit/ui/hooks';
```

## Utilities

- `cn` - Utility function
- `index` - Utility function
- `is-route-active` - Utility function

## Installation

```bash
pnpm add @kit/ui
```

## Package Dependencies

### Packages that use this:
- [dev-tool](../../apps/dev-tool)
- [web](../../apps/web)
- [@kit/billing](../billing/core)
- [@kit/billing-gateway](../billing/gateway)
- [@kit/lemon-squeezy](../billing/lemon-squeezy)
- [@kit/stripe](../billing/stripe)
- [@kit/keystatic](../cms/keystatic)
- [@kit/wordpress](../cms/wordpress)
- [@kit/accounts](../features/accounts)
- [@kit/admin](../features/admin)
- [@kit/auth](../features/auth)
- [@kit/notifications](../features/notifications)
- [@kit/team-accounts](../features/team-accounts)
- [@kit/otp](../otp)

## Code Statistics

- **Total Files**: 92
- **Total Lines**: 9,701

## Project Structure

```
packages/ui/
├── src/           # Source code
│   └── utils/       # Utility functions
│   ├── hooks/       # Custom React hooks
├── package.json   # Package configuration
├── tsconfig.json  # TypeScript configuration
└── README.md      # This file```

## Contributing

When making changes to this package:

1. Follow the existing code style and patterns
2. Update tests if applicable
3. Run `pnpm lint` and `pnpm typecheck` before committing
4. Update this README if adding new features or changing behavior

---

*Generated on 9/20/2025*
