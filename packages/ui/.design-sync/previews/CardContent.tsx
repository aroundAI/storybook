import { Key } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

export function Default() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Team members</CardTitle>
        <CardDescription>
          Manage who has access to this workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          You have 4 members in this workspace.
        </p>
      </CardContent>
    </Card>
  );
}

export function WithBadgeAndActions() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">OpenAI</CardTitle>
            <CardDescription className="text-sm">
              Used for episode ideation and screenplay generation.
            </CardDescription>
          </div>
          <Badge>Connected</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Key className="h-4 w-4" />
            <span>{'••••••' + 'a1b2'}</span>
          </div>
          <Button variant="outline" size="sm">
            Update
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
