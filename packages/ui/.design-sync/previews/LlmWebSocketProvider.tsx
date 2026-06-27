import { Radio } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { LlmWebSocketProvider } from '@kit/ui/hooks';

export function Default() {
  return (
    <LlmWebSocketProvider>
      <Card className="w-[320px]">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">Job Updates</CardTitle>
              <CardDescription className="text-sm">
                Live status for episode generation jobs.
              </CardDescription>
            </div>
            <Badge variant="outline">
              <Radio className="mr-1 h-3 w-3" />
              Idle
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Waiting for screenplay and shot-list jobs to report progress.
          </p>
        </CardContent>
      </Card>
    </LlmWebSocketProvider>
  );
}
