/**
 * Structured data as the text of a `<script type="application/ld+json">`.
 *
 * `JSON.stringify` alone is not safe there. The HTML parser ends a script
 * element at the first `</script>` whatever JSON thinks of it, so a title
 * containing one closes the element early and everything after is parsed as
 * markup — another `<script>` included. The public pages put team, project
 * and episode titles here, which any signed-in user writes.
 *
 * Escaping `<`, `>` and `&` as `<`, `>`, `&` leaves the JSON
 * identical to a JSON parser and gives the HTML parser nothing to act on.
 * U+2028 and U+2029 are escaped too: valid inside JSON strings, but line
 * terminators to pre-ES2019 JavaScript.
 *
 * Every JSON-LD site renders through `JsonLd` (lib/structured-data.tsx),
 * which calls this; `__tests__/json-ld.test.ts` fails on a
 * `JSON.stringify` passed to `dangerouslySetInnerHTML` anywhere else.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
