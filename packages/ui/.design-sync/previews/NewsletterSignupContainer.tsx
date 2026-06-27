import { NewsletterSignupContainer } from '@kit/ui/marketing';

export function Default() {
  return (
    <NewsletterSignupContainer
      onSignup={async (email) => {
        console.log('subscribe', email);
      }}
      heading="Stay Updated with StoryBook"
      description="Get the latest updates on AI video creation, new features, and production tips."
    />
  );
}
