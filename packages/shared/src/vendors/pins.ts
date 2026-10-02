import {
  META_GRAPH_VERSION,
  META_GRAPH_VERSION_EXPIRES,
  META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
} from './meta';
import { X_API_VERSION } from './x';

/**
 * Every pinned vendor API version, with the date its vendor stops serving it
 * and where that date was read (FILM-1723). The versions themselves are
 * declared in each vendor's file; this list only gathers them.
 *
 * `docs/platform-capability-reference.md` prints this list as its first table
 * ("Pinned vendor API versions"), and `vendor-api-versions.test.ts` fails when
 * the two disagree, and from 120 days before any `ends` unless an open
 * known bug named in `trackedBy` owns the move.
 */
export interface VendorApiPin {
  vendor: string;
  version: string;
  /** The vendor's documented end of support; null when it publishes none. */
  ends: string | null;
  /** `ends` is a guaranteed minimum, not a date the vendor has published. */
  endsIsFloor: boolean;
  /** The vendor page `ends` was read from. */
  source: string;
  /** The day `source` was read. */
  read: string;
  declaredIn: string;
  /** An open known bug that owns a pin already inside the warning window. */
  trackedBy: string | null;
}

export const VENDOR_API_PINS: readonly VendorApiPin[] = [
  {
    vendor: 'Meta Graph',
    version: META_GRAPH_VERSION,
    ends: META_GRAPH_VERSION_EXPIRES,
    endsIsFloor: META_GRAPH_VERSION_EXPIRY_IS_FLOOR,
    source: 'https://developers.facebook.com/docs/graph-api/changelog/',
    read: '2026-10-01',
    declaredIn: 'packages/shared/src/vendors/meta.ts',
    trackedBy: null,
  },
  {
    vendor: 'X',
    version: `v${X_API_VERSION}`,
    ends: null,
    endsIsFloor: false,
    source: 'https://docs.x.com/x-api/fundamentals/versioning',
    read: '2026-10-01',
    declaredIn: 'packages/shared/src/vendors/x.ts',
    trackedBy: null,
  },
];
