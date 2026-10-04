import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';

/**
 * StorybookStudio asked to connect, and none of the user's teams has it
 * turned on (FILM-2005): said here, with where to turn it on, rather than
 * offering a consent that would be refused.
 */
export function DesktopIntegrationOff(props: {
  clientName: string;
  teams: { id: string; name: string; slug: string }[];
}) {
  return (
    <Alert data-test="oauth-consent-desktop-off">
      <AlertTitle>
        {props.clientName} is not turned on for your teams
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          A team owner turns it on in the team&apos;s settings, under AI, with
          &ldquo;Edit in StorybookStudio&rdquo;. Then sign in from the app
          again.
        </p>
        <div className="flex flex-wrap gap-2">
          {props.teams.map((team) => (
            <Button
              key={team.id}
              asChild
              size="sm"
              variant="outline"
              className="h-auto max-w-full py-1.5 text-left whitespace-normal"
            >
              <Link
                href={`/home/${team.slug}/settings/ai`}
                data-test={`oauth-consent-desktop-off-${team.slug}`}
              >
                AI settings of {team.name}
              </Link>
            </Button>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  );
}
