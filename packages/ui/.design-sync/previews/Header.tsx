import Link from 'next/link';

import { Film } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Header } from '@kit/ui/marketing';

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-x-2 font-semibold">
      <Film className="h-5 w-5" />
      StoryBook
    </Link>
  );
}

function Nav() {
  return (
    <nav className="hidden items-center gap-x-6 text-sm font-medium md:flex">
      <Link
        href="/pricing"
        className="text-muted-foreground hover:text-foreground"
      >
        Pricing
      </Link>
      <Link
        href="/docs"
        className="text-muted-foreground hover:text-foreground"
      >
        Docs
      </Link>
      <Link
        href="/contact"
        className="text-muted-foreground hover:text-foreground"
      >
        Contact
      </Link>
    </nav>
  );
}

export function Default() {
  return (
    <div className="max-w-3xl border-b">
      <Header
        logo={<Logo />}
        navigation={<Nav />}
        actions={
          <>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/auth/sign-in">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/auth/sign-up">Get Started</Link>
            </Button>
          </>
        }
      />
    </div>
  );
}
