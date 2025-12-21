'use client';

interface ActDividerProps {
  actNumber: string;
}

const ACT_NAMES: Record<string, string> = {
  '1': 'Act One',
  ONE: 'Act One',
  I: 'Act One',
  '2': 'Act Two',
  TWO: 'Act Two',
  II: 'Act Two',
  '3': 'Act Three',
  THREE: 'Act Three',
  III: 'Act Three',
  '4': 'Act Four',
  FOUR: 'Act Four',
  IV: 'Act Four',
  '5': 'Act Five',
  FIVE: 'Act Five',
  V: 'Act Five',
};

export function ActDivider({ actNumber }: ActDividerProps) {
  const displayName = ACT_NAMES[actNumber.toUpperCase()] ?? `Act ${actNumber}`;

  return (
    <div className="my-12 flex items-center gap-6">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600" />
      <span className="font-serif text-xl font-bold tracking-[0.25em] text-gray-400 dark:text-gray-500">
        {displayName.toUpperCase()}
      </span>
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-gray-300 to-transparent dark:via-gray-600" />
    </div>
  );
}
