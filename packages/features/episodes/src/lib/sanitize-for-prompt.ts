/**
 * Sanitize user-controlled strings before injecting into LLM prompts.
 *
 * Mitigates common prompt injection vectors:
 * - Markdown/template delimiters (---, ```, {{ }})
 * - XML-style role markers (<system>, <user>, <assistant>, etc.)
 * - Instruction override patterns (IGNORE PREVIOUS, SYSTEM OVERRIDE)
 *
 * Uses iterative tag stripping to prevent nested tag bypass
 * (e.g., `<<system>system>` → `<system>` after single pass).
 */
export function sanitizeForPrompt(input: string): string {
    let result = input
        .replace(/---/g, '—')
        .replace(/```/g, "'''")
        .replace(/\{\{/g, '{ {')
        .replace(/\}\}/g, '} }')
        .replace(
            /\bIGNORE\s+(?:ALL\s+)?(?:PREVIOUS|ABOVE)\b|\bSYSTEM\s+OVERRIDE\b/gi,
            '[FILTERED]',
        );

    // Iteratively strip role tags to prevent nested bypass
    const roleTagPattern =
        /<\/?(?:system|user|assistant|prompt|instruction)[^>]*>/gi;
    let previous = '';

    while (previous !== result) {
        previous = result;
        result = result.replace(roleTagPattern, '');
    }

    return result;
}
