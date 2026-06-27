import { Button } from '@kit/ui/button';
import { OauthProviderLogoImage } from '@kit/ui/oauth-provider-logo-image';

// "google"/"github"/"facebook"/"microsoft"/"apple" resolve to local
// `next/image` paths (`/images/oauth/<provider>.webp`) served from
// apps/web/public at runtime — this isolated preview bundle has no
// equivalent static file server behind that path, so those render as
// broken-image icons. "twitter" (inline SVG) and "email"/"phone" (lucide
// icons) don't depend on that path and render correctly, so the Default
// story uses those instead — still real provider options the component
// ships, just ones that don't hit the missing-asset gap.
export function Default() {
  return (
    <div className="flex flex-col gap-3">
      <Button className="flex w-full gap-x-3 text-center" variant="outline">
        <OauthProviderLogoImage providerId="twitter" />
        <span>Continue with X</span>
      </Button>
      <Button className="flex w-full gap-x-3 text-center" variant="outline">
        <OauthProviderLogoImage providerId="email" />
        <span>Continue with Email</span>
      </Button>
    </div>
  );
}

export function EmailAndPhone() {
  return (
    <div className="flex flex-col gap-3">
      <Button className="flex w-full gap-x-3 text-center" variant="outline">
        <OauthProviderLogoImage providerId="email" />
        <span>Continue with Email</span>
      </Button>
      <Button className="flex w-full gap-x-3 text-center" variant="outline">
        <OauthProviderLogoImage providerId="phone" />
        <span>Continue with Phone</span>
      </Button>
    </div>
  );
}
