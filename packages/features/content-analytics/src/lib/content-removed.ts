/**
 * A definite "this video does not exist" from a platform (KB-207), as
 * distinct from every other failed read. Only this marks a publish
 * removed; an expired token, a rate limit, a 5xx or a refusal of any other
 * kind leaves the row alone and is retried on its next visit.
 */
export class PublishedContentMissingError extends Error {
  override readonly name = 'PublishedContentMissingError';

  constructor(
    readonly platform: string,
    readonly contentId: string,
  ) {
    super(`${platform} says ${contentId} does not exist`);
  }
}

interface GraphError {
  code?: number;
  error_subcode?: number;
  message?: string;
}

/**
 * Meta's answer for an object that is not there: code 100 with subcode 33
 * ("Object with ID … does not exist"), or a 404 saying it does not exist.
 */
export function isGraphObjectMissing(
  status: number,
  error: GraphError | undefined,
): boolean {
  if (error?.code === 100 && error.error_subcode === 33) return true;

  return status === 404 && /does not exist/i.test(error?.message ?? '');
}
