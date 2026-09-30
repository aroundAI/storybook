export interface CharacterDelta {
  id: string;
  entity_type: string;
  entity_id: string;
  before_state: unknown;
  after_state: unknown;
  change_reason: string | null;
  created_at: string | null;
}

/** The character's changes, newest first, from an episode's audit log. */
export function characterHistory(
  deltas: CharacterDelta[],
  characterId: string,
): CharacterDelta[] {
  return deltas
    .filter(
      (delta) =>
        delta.entity_type === 'character' && delta.entity_id === characterId,
    )
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
}

/**
 * Only the newest change can be rolled back: undoing an older one would undo
 * the later ones with it, and the server refuses that. The first state
 * recorded for a character has nothing before it to restore.
 */
export function rollbackableDeltaId(history: CharacterDelta[]): string | null {
  const [newest] = history;
  return newest && newest.before_state !== null ? newest.id : null;
}

const MAX_LENGTH = 80;

export function describeStateValue(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (typeof value === 'string') return value;

  if (typeof value === 'object') {
    const { state, arc } = value as { state?: unknown; arc?: unknown };
    if (typeof state === 'string') return state;
    if (typeof arc === 'string') return arc;
  }

  const text = JSON.stringify(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}...` : text;
}
