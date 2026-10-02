import type { CardClaim } from '../overview/card-claim';

/**
 * The claims the Audience cards lead with (FILM-1707 on FILM-1706's
 * shell). Shares are what the platforms report; a tie names every leader
 * rather than picking one, and nothing here says "per video": a platform
 * whose audience is the account's has the shell say so.
 */

const percent = (share: number) => `${share.toFixed(1)}%`;

function leaders<T>(items: readonly T[], value: (item: T) => number): T[] {
  const top = Math.max(...items.map(value));

  return items.filter((item) => value(item) === top);
}

function joined(labels: readonly string[]): string {
  return labels.length <= 1
    ? labels.join('')
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/** The largest group of a reported breakdown, or why there is none. */
function largestShareClaim(
  groups: readonly { label: string; percentage: number }[],
  {
    noun,
    absent,
  }: { noun: string; absent: { noFigure: string; sentence: string } },
): CardClaim {
  if (groups.length === 0) return { figure: null, ...absent };

  const top = leaders(groups, ({ percentage }) => percentage);
  const figure = percent(top[0]!.percentage);

  return top.length > 1
    ? {
        figure,
        sentence: `${joined(top.map(({ label }) => label))} are level as the largest ${noun}.`,
      }
    : { figure, sentence: `${top[0]!.label} is the largest ${noun}.` };
}

export function topAgeGroupClaim(
  groups: readonly { label: string; percentage: number }[],
): CardClaim {
  return largestShareClaim(groups, {
    noun: 'age group',
    absent: {
      noFigure: 'No ages reported yet.',
      sentence: 'No platform has reported viewer ages for this project yet.',
    },
  });
}

export function topDeviceClaim(
  devices: readonly { label: string; percentage: number }[],
): CardClaim {
  return largestShareClaim(devices, {
    noun: 'device type',
    absent: {
      noFigure: 'No device data.',
      sentence: 'None of this project’s videos has a device breakdown yet.',
    },
  });
}

export const NO_GENDER_CLAIM: CardClaim = {
  figure: null,
  noFigure: 'No gender reported yet.',
  sentence: 'No platform has reported viewer gender for this project yet.',
};
