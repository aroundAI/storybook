import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { decrypt } from '@kit/shared/crypto';

import { ChannelPicker } from './_components/channel-picker';

interface PendingConnection {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  channels: Array<{
    id: string;
    title: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
  }>;
  returnUrl: string;
  nonce: string;
}

interface Props {
  params: Promise<{ account: string }>;
}

export default async function SelectChannelPage({ params }: Props) {
  const { account } = await params;
  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get('youtube_pending_connection');

  if (!pendingCookie?.value) {
    // No pending connection - redirect back to platforms
    redirect(`/home/${account}/settings/platforms?error=no_pending_connection`);
  }

  let pendingConnection: PendingConnection;
  try {
    const decrypted = await decrypt(pendingCookie.value);
    pendingConnection = JSON.parse(decrypted);
  } catch {
    // Invalid or expired pending connection
    redirect(
      `/home/${account}/settings/platforms?error=invalid_pending_connection`,
    );
  }

  return (
    <div className="container mx-auto max-w-2xl py-12">
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Select YouTube Channel</h1>
          <p className="text-muted-foreground mt-2">
            Choose which channel you want to connect to your account
          </p>
        </div>

        <ChannelPicker
          channels={pendingConnection.channels}
          accountSlug={account}
        />
      </div>
    </div>
  );
}
