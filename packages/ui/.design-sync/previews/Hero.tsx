import Link from 'next/link';

import { ChevronRight } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Hero, Pill } from '@kit/ui/marketing';

export function Default() {
  return (
    <div className="max-w-3xl">
      <Hero
        animate={false}
        pill={
          <Pill label="New">
            <span className="bg-gradient-to-r from-blue-500 to-indigo-500 bg-clip-text font-semibold text-transparent">
              Deepseek V3 Integration Now Live
            </span>
          </Pill>
        }
        title={
          <>
            The AI-Powered <br />
            Story Engine
          </>
        }
        subtitle="From undefined concept to Season 1 greenlight. Manage characters, locations, and storylines with generative AI."
        cta={
          <div className="flex flex-col gap-4 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/auth/sign-up">
                Get Started
                <ChevronRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/contact">Contact Us</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
