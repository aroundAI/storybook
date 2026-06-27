import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';

export function Default() {
  return (
    <Avatar>
      <AvatarImage src="https://i.pravatar.cc/150?img=12" alt="Jordan Avery" />
      <AvatarFallback>JA</AvatarFallback>
    </Avatar>
  );
}

export function FallbackOnly() {
  return (
    <div className="flex items-center gap-3">
      <Avatar>
        <AvatarFallback>MF</AvatarFallback>
      </Avatar>
      <div>
        <p className="text-sm font-medium">Midnight Frequency</p>
        <p className="text-muted-foreground text-xs">Season 1 · 8 episodes</p>
      </div>
    </div>
  );
}

export function TeamStack() {
  const members = [
    { name: 'Priya Shah', img: 'https://i.pravatar.cc/150?img=32' },
    { name: 'Theo Marsh', img: 'https://i.pravatar.cc/150?img=15' },
    { name: 'Lena Cho', img: null },
  ];

  return (
    <div className="flex -space-x-2">
      {members.map((member) => (
        <Avatar key={member.name} className="border-background border-2">
          {member.img ? (
            <AvatarImage src={member.img} alt={member.name} />
          ) : null}
          <AvatarFallback>
            {member.name
              .split(' ')
              .map((part) => part[0])
              .join('')}
          </AvatarFallback>
        </Avatar>
      ))}
    </div>
  );
}
