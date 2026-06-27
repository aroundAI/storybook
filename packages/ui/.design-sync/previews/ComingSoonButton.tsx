import { Film } from 'lucide-react';

import {
  ComingSoon,
  ComingSoonButton,
  ComingSoonHeading,
  ComingSoonLogo,
  ComingSoonText,
} from '@kit/ui/marketing';

export function Default() {
  return (
    <div className="relative h-[480px] max-w-3xl overflow-hidden rounded-lg border">
      <ComingSoon className="absolute inset-0 min-h-0">
        <ComingSoonLogo className="!static flex items-center gap-x-2 font-semibold">
          <Film className="h-5 w-5" />
          StoryBook
        </ComingSoonLogo>

        <ComingSoonHeading>Season 2 is coming soon</ComingSoonHeading>

        <ComingSoonText>
          We&apos;re building the next generation of AI-powered showrunning
          tools. Sign up to get notified when it launches.
        </ComingSoonText>

        <ComingSoonButton>
          <a href="/auth/sign-up">Notify Me</a>
        </ComingSoonButton>
      </ComingSoon>
    </div>
  );
}
