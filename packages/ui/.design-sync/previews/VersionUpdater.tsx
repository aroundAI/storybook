import { RocketIcon } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';

// VersionUpdater polls /version on an interval and renders nothing until a
// version change is detected, then shows this AlertDialog — there's no
// prop to force that open state from outside, so the preview reproduces
// the dialog it renders once `didChange` is true.
export function Default() {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-x-2">
            <RocketIcon className="h-4 w-4" />
            <span>New version available</span>
          </AlertDialogTitle>
          <AlertDialogDescription>
            A new version of Storybook Studio has been deployed. Reload to
            get the latest features and fixes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline">Later</Button>
          <Button>Reload now</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
