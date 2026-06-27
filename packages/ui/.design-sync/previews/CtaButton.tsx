import { ArrowRight } from 'lucide-react';

import { CtaButton } from '@kit/ui/marketing';

export function Default() {
  return (
    <CtaButton>
      <a href="/auth/sign-up" className="flex items-center gap-x-1.5">
        Get Started
        <ArrowRight className="h-4 w-4" />
      </a>
    </CtaButton>
  );
}

export function ButtonGroup() {
  return (
    <div className="flex justify-center space-x-4">
      <CtaButton>
        <a href="/auth/sign-up">Get Started</a>
      </CtaButton>
      <CtaButton variant="link">
        <a href="/contact">Contact Us</a>
      </CtaButton>
    </div>
  );
}
