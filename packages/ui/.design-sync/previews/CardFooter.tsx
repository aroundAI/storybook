import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

export function Default() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete project</CardTitle>
        <CardDescription>
          This will permanently remove all seasons, episodes, and rendered
          assets for this project.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          12 episodes · 4 seasons · last edited 3 days ago
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Button variant="destructive" size="sm">
          Delete project
        </Button>
      </CardFooter>
    </Card>
  );
}
