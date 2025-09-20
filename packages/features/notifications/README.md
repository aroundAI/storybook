# @kit/notifications

Real-time notification system with Supabase Realtime for instant updates and persistent notification storage.

## Purpose

This package provides a complete notification system including:
- Real-time notifications using Supabase Realtime
- Persistent notification storage
- Notification streaming and subscriptions
- Read/unread status management
- Notification dismissal and archiving
- Multi-channel notification support

## Installation

```bash
pnpm add @kit/notifications
```

## Real-time Notifications

### Using the Notifications Stream Hook

```tsx
'use client';
import { useNotificationsStream } from '@kit/notifications/hooks/use-notifications-stream';

function NotificationBell() {
  // Subscribe to real-time notifications
  const { notifications, unreadCount } = useNotificationsStream({
    accountId: account.id,
    userId: user.id
  });

  return (
    <div className="relative">
      <Bell className="h-5 w-5" />
      {unreadCount > 0 && (
        <Badge className="absolute -top-1 -right-1">
          {unreadCount}
        </Badge>
      )}
    </div>
  );
}
```

### Notification Provider

```tsx
import { NotificationsProvider } from '@kit/notifications/components/notifications-provider';

export function AppLayout({ children }) {
  return (
    <NotificationsProvider accountId={account.id} userId={user.id}>
      {children}
    </NotificationsProvider>
  );
}
```

## Fetching Notifications

### useFetchNotifications Hook

```tsx
import { useFetchNotifications } from '@kit/notifications/hooks/use-fetch-notifications';

function NotificationsList() {
  const { data: notifications, isLoading } = useFetchNotifications({
    accountId: account.id,
    limit: 20,
    unreadOnly: false
  });

  if (isLoading) return <Spinner />;

  return (
    <div className="space-y-2">
      {notifications?.map((notification) => (
        <NotificationItem key={notification.id} notification={notification} />
      ))}
    </div>
  );
}
```

### Filtering Notifications

```tsx
// Fetch only unread notifications
const { data: unreadNotifications } = useFetchNotifications({
  accountId: account.id,
  unreadOnly: true
});

// Fetch by type
const { data: systemNotifications } = useFetchNotifications({
  accountId: account.id,
  type: 'system'
});

// Paginated fetch
const { data, fetchNextPage, hasNextPage } = useFetchNotifications({
  accountId: account.id,
  limit: 10,
  offset: 0
});
```

## Managing Notifications

### Dismissing Notifications

```tsx
import { useDismissNotification } from '@kit/notifications/hooks/use-dismiss-notification';

function NotificationItem({ notification }) {
  const dismiss = useDismissNotification();

  const handleDismiss = async () => {
    await dismiss.mutateAsync(notification.id);
    toast.success('Notification dismissed');
  };

  return (
    <div className="flex items-center justify-between p-4">
      <div>
        <h4>{notification.title}</h4>
        <p>{notification.body}</p>
      </div>
      <Button onClick={handleDismiss} variant="ghost" size="sm">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### Mark as Read

```tsx
import { useMarkAsRead } from '@kit/notifications/hooks/use-mark-as-read';

function UnreadNotification({ notification }) {
  const markAsRead = useMarkAsRead();

  const handleRead = async () => {
    await markAsRead.mutateAsync(notification.id);
  };

  return (
    <div onClick={handleRead} className={notification.read ? '' : 'font-semibold'}>
      {notification.title}
    </div>
  );
}
```

### Mark All as Read

```tsx
import { useMarkAllAsRead } from '@kit/notifications/hooks/use-mark-all-as-read';

function NotificationHeader() {
  const markAllAsRead = useMarkAllAsRead();

  return (
    <div className="flex justify-between">
      <h3>Notifications</h3>
      <Button onClick={() => markAllAsRead.mutateAsync(account.id)} variant="link">
        Mark all as read
      </Button>
    </div>
  );
}
```

## Notification Components

### Notification Panel

```tsx
import { NotificationPanel } from '@kit/notifications/components/notification-panel';

function Header() {
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <>
      <Button onClick={() => setShowNotifications(true)}>
        <Bell />
      </Button>

      <NotificationPanel
        open={showNotifications}
        onClose={() => setShowNotifications(false)}
        accountId={account.id}
        userId={user.id}
      />
    </>
  );
}
```

### Notification List Component

```tsx
import { NotificationList } from '@kit/notifications/components/notification-list';

function NotificationsPage() {
  return (
    <NotificationList
      accountId={account.id}
      userId={user.id}
      showFilters={true}
      showSearch={true}
      pageSize={20}
    />
  );
}
```

### Notification Toast

```tsx
import { useNotificationToast } from '@kit/notifications/hooks/use-notification-toast';

function App() {
  // Automatically shows toast for new notifications
  useNotificationToast({
    position: 'top-right',
    duration: 5000,
    playSound: true
  });

  return <YourApp />;
}
```

## Creating Notifications (Server-side)

### Send Notification

```typescript
import { createNotification } from '@kit/notifications/server/create-notification';

async function sendNotification(userId: string, accountId: string) {
  await createNotification({
    account_id: accountId,
    user_id: userId,
    type: 'info',
    title: 'New team member',
    body: 'John Doe has joined your team',
    link: '/team/members',
    metadata: {
      member_id: 'member_123',
      member_name: 'John Doe'
    }
  });
}
```

### Broadcast to Team

```typescript
import { broadcastNotification } from '@kit/notifications/server/broadcast';

async function notifyTeam(accountId: string, message: string) {
  await broadcastNotification({
    account_id: accountId,
    type: 'announcement',
    title: 'Team Announcement',
    body: message,
    exclude_user_ids: [], // Optional: exclude specific users
  });
}
```

### System Notifications

```typescript
import { sendSystemNotification } from '@kit/notifications/server/system';

async function notifySystemMaintenance() {
  await sendSystemNotification({
    type: 'system',
    severity: 'warning',
    title: 'Scheduled Maintenance',
    body: 'System will be unavailable from 2 AM to 4 AM UTC',
    expires_at: new Date('2024-01-20T02:00:00Z')
  });
}
```

## Notification Types

```typescript
export enum NotificationType {
  INFO = 'info',
  SUCCESS = 'success',
  WARNING = 'warning',
  ERROR = 'error',
  SYSTEM = 'system',
  BILLING = 'billing',
  SECURITY = 'security',
  TEAM = 'team',
  ANNOUNCEMENT = 'announcement'
}

export interface Notification {
  id: string;
  account_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  dismissed: boolean;
  metadata?: Record<string, any>;
  created_at: string;
  expires_at?: string;
}
```

## Real-time Subscription Management

### Custom Channel Subscription

```typescript
import { subscribeToNotifications } from '@kit/notifications/realtime/subscribe';

const subscription = subscribeToNotifications({
  accountId: account.id,
  userId: user.id,
  onNotification: (notification) => {
    console.log('New notification:', notification);
    // Handle new notification
  },
  onError: (error) => {
    console.error('Subscription error:', error);
  }
});

// Cleanup
subscription.unsubscribe();
```

### Presence Tracking

```tsx
import { useNotificationPresence } from '@kit/notifications/hooks/use-notification-presence';

function TeamNotifications() {
  const { onlineUsers } = useNotificationPresence(account.id);

  return (
    <div>
      <p>{onlineUsers.length} team members online</p>
    </div>
  );
}
```

## Notification Preferences

### User Preferences

```tsx
import { NotificationPreferences } from '@kit/notifications/components/notification-preferences';

function SettingsPage() {
  return (
    <NotificationPreferences
      userId={user.id}
      onSave={(preferences) => {
        toast.success('Preferences updated');
      }}
    />
  );
}
```

### Check Preferences

```typescript
import { getUserNotificationPreferences } from '@kit/notifications/queries/preferences';

const preferences = await getUserNotificationPreferences(userId);

if (preferences.email_notifications) {
  // Send email notification
}

if (preferences.push_notifications) {
  // Send push notification
}
```

## Database Schema

```sql
-- Notifications table
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  link VARCHAR(500),
  read BOOLEAN DEFAULT FALSE,
  dismissed BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);
CREATE INDEX idx_notifications_account ON notifications(account_id, created_at DESC);

-- RLS policies
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
```

## Testing

```typescript
import { createMockNotification } from '@kit/notifications/testing';

describe('Notifications', () => {
  it('should display notification', () => {
    const notification = createMockNotification({
      title: 'Test Notification',
      body: 'Test body'
    });

    // Test notification display
  });
});
```

## Best Practices

1. **Batch notifications** when sending to multiple users
2. **Set expiry dates** for time-sensitive notifications
3. **Use appropriate types** for better filtering
4. **Include actionable links** in notifications
5. **Clean up old notifications** periodically
6. **Implement rate limiting** for notification creation
7. **Use metadata** for additional context

## Package Dependencies

### External
- `@supabase/supabase-js`: Realtime subscriptions
- `react-query`: Data fetching and caching

### Internal
- `@kit/supabase`: Database client
- `@kit/ui`: UI components
- `@kit/shared`: Shared utilities

### Packages that use this:
- [web](../../../apps/web)

## Contributing

When making changes to this package:

1. Test real-time functionality thoroughly
2. Ensure RLS policies are correct
3. Handle connection failures gracefully
4. Run `pnpm typecheck` before committing
5. Update notification types as needed

---

*Updated on 9/20/2025*