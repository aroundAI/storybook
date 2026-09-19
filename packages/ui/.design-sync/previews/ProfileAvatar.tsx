import { ProfileAvatar } from '@kit/ui/profile-avatar';

export function Default() {
  return (
    <ProfileAvatar
      displayName="Mara Voss"
      pictureUrl="https://i.pravatar.cc/150?img=47"
    />
  );
}

export function FallbackInitial() {
  return (
    <div className="flex items-center gap-3">
      <ProfileAvatar displayName="Theo Marsh" pictureUrl={null} />
      <div>
        <p className="text-sm font-medium">Theo Marsh</p>
        <p className="text-xs text-muted-foreground">theo@storybook.studio</p>
      </div>
    </div>
  );
}

export function TextVariant() {
  return <ProfileAvatar text="Midnight Frequency" />;
}
