/**
 * Escape XML-sensitive characters to prevent tag breakout in LLM prompts.
 *
 * Since LLM prompts use XML tags (e.g. <articles>) to delimit untrusted
 * input, any literal '<' or '>' in user-provided values could break out
 * of the delimiter and inject rogue instructions.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
