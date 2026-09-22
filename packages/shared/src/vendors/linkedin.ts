/**
 * The `LinkedIn-Version` header, declared once (FILM-1723). It was written
 * separately in the provider and in the publish lambda.
 *
 * **The value is inherited, not chosen.** LinkedIn keeps a monthly version
 * active for about a year, which would put 202401 well past sunset - but every
 * call that sends it goes to `/v2/...`, and the header is documented for
 * `/rest/...`. Whether it matters could not be settled without a LinkedIn
 * token (an unauthenticated probe returns 401 before the version is looked
 * at), so FILM-1723 collapsed the two copies and changed nothing else. Choose
 * a version deliberately before moving any call to `/rest/`.
 */
export const LINKEDIN_REST_VERSION = '202401';
