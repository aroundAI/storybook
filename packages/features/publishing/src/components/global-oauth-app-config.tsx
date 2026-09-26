'use client';

import { useState, useTransition } from 'react';

import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Facebook,
  Loader2,
  Save,
  Youtube,
} from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';

import {
  SAVED_CREDENTIAL_APPS,
  type SavedCredentialApp,
  type SavedCredentialSource,
} from '../oauth/apps';
import { saveGlobalOAuthAppAction } from '../server/global-oauth-actions';
import type { GlobalOAuthApp } from '../server/global-oauth-actions';

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
  </svg>
);

interface PlatformOAuthConfig {
  id: SavedCredentialApp;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  setupUrl: string;
  clientIdLabel: string;
  clientSecretLabel: string;
  setupSteps: string[];
}

/** One card per `SAVED_CREDENTIAL_APPS` entry: a missing or extra key fails typecheck. */
const PLATFORMS: {
  [App in SavedCredentialApp]: PlatformOAuthConfig & { id: App };
} = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    icon: Youtube,
    color: 'text-red-500',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    clientIdLabel: 'Client ID',
    clientSecretLabel: 'Client Secret',
    setupSteps: [
      'Create a project in Google Cloud Console',
      'Enable YouTube Data API v3',
      'Create OAuth 2.0 credentials (Web application)',
      'Add the redirect URI shown below',
      'Copy Client ID and Client Secret',
    ],
  },
  tiktok: {
    id: 'tiktok',
    name: 'TikTok',
    icon: TikTokIcon,
    color: 'text-black dark:text-white',
    setupUrl: 'https://developers.tiktok.com',
    clientIdLabel: 'Client Key',
    clientSecretLabel: 'Client Secret',
    setupSteps: [
      'Create an app in TikTok Developer Portal',
      'Add the redirect URI shown below',
      'Copy Client Key and Client Secret',
    ],
  },
  meta: {
    id: 'meta',
    name: 'Meta (Instagram/Facebook)',
    icon: Facebook,
    color: 'text-blue-600',
    setupUrl: 'https://developers.facebook.com',
    clientIdLabel: 'App ID',
    clientSecretLabel: 'App Secret',
    setupSteps: [
      'Create an app in Meta for Developers',
      'Configure Instagram Basic Display or Facebook Login',
      'Add the redirect URI shown below',
      'Copy App ID and App Secret',
    ],
  },
};

interface GlobalOAuthAppConfigProps {
  existingApps?: GlobalOAuthApp[];
  sources: Record<SavedCredentialApp, SavedCredentialSource>;
  appUrl: string;
}

export function GlobalOAuthAppConfig({
  existingApps = [],
  sources,
  appUrl,
}: GlobalOAuthAppConfigProps) {
  return (
    <div className="space-y-6">
      {SAVED_CREDENTIAL_APPS.map((app) => {
        const platform = PLATFORMS[app];
        const existingApp = existingApps.find((a) => a.platform === app);
        return (
          <GlobalPlatformCredentialsCard
            key={app}
            platform={platform}
            existingApp={existingApp}
            source={sources[app]}
            redirectUri={`${appUrl}/api/platforms/callback/${app}`}
          />
        );
      })}
    </div>
  );
}

const SOURCE_LABELS: Record<
  SavedCredentialSource,
  { text: string; className: string }
> = {
  saved: {
    text: 'Saved here',
    className: 'text-green-600 dark:text-green-400',
  },
  env: {
    text: 'From environment variables',
    className: 'text-green-600 dark:text-green-400',
  },
  unreadable: {
    text: 'Saved, but cannot be read. Save it again',
    className: 'text-destructive',
  },
  none: {
    text: 'Not configured',
    className: 'text-amber-600 dark:text-amber-400',
  },
};

/** Which credentials connect and refresh use right now (KB-36). */
function CredentialSourceLabel({
  app,
  source,
}: {
  app: SavedCredentialApp;
  source: SavedCredentialSource;
}) {
  const label = SOURCE_LABELS[source];

  return (
    <span
      data-test={`oauth-app-source-${app}`}
      data-source={source}
      className={`flex items-center gap-1 ${label.className}`}
    >
      {source === 'saved' || source === 'env' ? (
        <Check className="h-3 w-3" />
      ) : null}
      {label.text}
    </span>
  );
}

interface GlobalPlatformCredentialsCardProps {
  platform: PlatformOAuthConfig;
  existingApp?: GlobalOAuthApp;
  source: SavedCredentialSource;
  redirectUri: string;
}

function GlobalPlatformCredentialsCard({
  platform,
  existingApp,
  source,
  redirectUri,
}: GlobalPlatformCredentialsCardProps) {
  const [isPending, startTransition] = useTransition();
  const [clientId, setClientId] = useState(existingApp?.clientId ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const Icon = platform.icon;
  const isConfigured = !!existingApp;

  const handleSave = () => {
    if (!clientId || !clientSecret) {
      toast.error('Please enter both Client ID and Client Secret');
      return;
    }

    startTransition(async () => {
      try {
        await saveGlobalOAuthAppAction({
          platform: platform.id,
          clientId,
          clientSecret,
        });
        toast.success(`${platform.name} credentials saved!`);
        setClientSecret(''); // Clear secret after save
      } catch {
        toast.error('Failed to save credentials');
      }
    });
  };

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon className={`h-6 w-6 ${platform.color}`} />
            <div>
              <CardTitle className="text-lg">{platform.name}</CardTitle>
              <CardDescription>
                <CredentialSourceLabel app={platform.id} source={source} />
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a
              href={platform.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Developer Console
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Setup Instructions */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ol className="ml-4 list-decimal space-y-1 text-sm">
              {platform.setupSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </AlertDescription>
        </Alert>

        {/* Redirect URI */}
        <div>
          <Label className="text-xs text-muted-foreground">
            Redirect URI (copy this)
          </Label>
          <div className="mt-1 flex items-center gap-2">
            <Input value={redirectUri} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="sm" onClick={copyRedirectUri}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Credentials Input */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor={`${platform.id}-client-id`}>
              {platform.clientIdLabel}
            </Label>
            <Input
              id={`${platform.id}-client-id`}
              data-test={`oauth-app-client-id-${platform.id}`}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={`Enter ${platform.clientIdLabel}`}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`${platform.id}-client-secret`}>
              {platform.clientSecretLabel}
            </Label>
            <div className="relative mt-1">
              <Input
                id={`${platform.id}-client-secret`}
                data-test={`oauth-app-client-secret-${platform.id}`}
                type={showSecret ? 'text' : 'password'}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  isConfigured
                    ? '••••••••••••'
                    : `Enter ${platform.clientSecretLabel}`
                }
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button
            data-test={`oauth-app-save-${platform.id}`}
            onClick={handleSave}
            disabled={isPending || !clientId || !clientSecret}
          >
            {isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {isConfigured ? 'Update Credentials' : 'Save Credentials'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
