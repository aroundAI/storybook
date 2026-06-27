import { NewsletterSignup } from '@kit/ui/marketing';

export function Default() {
  return (
    <NewsletterSignup
      onSignup={(data) => console.log('subscribe', data.email)}
      placeholder="you@studio.com"
      buttonText="Subscribe"
    />
  );
}
