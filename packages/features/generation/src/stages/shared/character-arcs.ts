/**
 * Merge story-specific character arcs into the pre-formatted character
 * context block.
 *
 * The `assets` table provides identity: name, role, personality, physical
 * attributes. `story_data.characters[]` provides episode-specific arcs: how
 * the character changes. This appends the arc into each character's block
 * of the formatted string, matching by name (case-insensitive), so one
 * prompt block carries BOTH identity constraints AND narrative arc guidance.
 *
 * Moved here from the LLM worker's context builder, which re-exports it:
 * the screenplay stage renders the same block for its brief.
 */
export function mergeCharacterArcs(
  formattedCharacters: string,
  storyCharacters: Array<{ name: string; role: string; arc: string }>,
): string {
  if (storyCharacters.length === 0 || !formattedCharacters) {
    return formattedCharacters;
  }

  const arcMap = new Map(
    storyCharacters
      .filter((c) => c.arc)
      .map((c) => [c.name.toLowerCase().trim(), c.arc]),
  );

  if (arcMap.size === 0) return formattedCharacters;

  // The block reads "CHARACTER n — LOCKED IDENTITY (...):" then indented
  // "Name: X" lines; the arc goes in before the next header or the end.
  const lines = formattedCharacters.split('\n');
  const enrichedLines: string[] = [];
  let pendingArc: string | null = null;

  for (const line of lines) {
    if (line.startsWith('CHARACTER ') && pendingArc) {
      enrichedLines.push(`  Arc in this episode: ${pendingArc}`);
      pendingArc = null;
    }

    enrichedLines.push(line);

    const nameMatch = line.match(/^\s+Name:\s+(.+)$/);

    if (nameMatch) {
      const arc = arcMap.get(nameMatch[1]!.toLowerCase().trim());

      if (arc) pendingArc = arc;
    }
  }

  if (pendingArc) {
    enrichedLines.push(`  Arc in this episode: ${pendingArc}`);
  }

  return enrichedLines.join('\n');
}
