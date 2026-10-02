import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { OAUTH_APPS } from '@kit/publishing/oauth/apps';

import {
  CONNECT_FAILURE_CODES,
  CONNECT_PLATFORMS,
  accountIdFromUnverifiedState,
  chooseAccountSlug,
  cleanVendorText,
  connectFailurePath,
  connectFailureQuery,
  failureCodeForVendorError,
  readConnectFailure,
} from '../connect-failure';

const ACCOUNT_ID = '7d0e2f6c-1a4b-4c8e-9f30-5b6a7c8d9e0f';

function encodeState(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// KB-29: one list of OAuth apps. A platform whose connect can fail must be one
// the credential resolver knows, and the other way round.
describe('CONNECT_PLATFORMS', () => {
  it('names exactly the OAuth apps the credential resolver serves', () => {
    expect([...CONNECT_PLATFORMS].sort()).toEqual([...OAUTH_APPS].sort());
  });
});

describe('failureCodeForVendorError', () => {
  it.each([
    ['access_denied', 'access_denied'],
    ['ACCESS_DENIED', 'access_denied'],
    ['user_denied', 'access_denied'],
    ['invalid_scope', 'invalid_scope'],
    // Not an RFC name: whatever a vendor calls a refused scope reads as one.
    ['scope_not_authorized', 'invalid_scope'],
    ['server_error', 'vendor_unavailable'],
    ['temporarily_unavailable', 'vendor_unavailable'],
    ['unauthorized_client', 'app_misconfigured'],
    ['something_new', 'vendor_error'],
  ])('%s → %s', (vendorError, code) => {
    expect(failureCodeForVendorError(vendorError)).toBe(code);
  });
});

describe('readConnectFailure', () => {
  it('is null when the address reports no failure', () => {
    expect(readConnectFailure({})).toBeNull();
    expect(readConnectFailure({ success: 'youtube_connected' })).toBeNull();
  });

  it('reads back what connectFailureQuery wrote', () => {
    const failure = {
      code: 'invalid_scope',
      platform: 'tiktok',
      vendorCode: 'scope_not_authorized',
      vendorMessage: 'Scope video.list is not authorized',
      vendorLogId: '20260922ABCDEF',
    } as const;

    expect(
      readConnectFailure(Object.fromEntries(connectFailureQuery(failure))),
    ).toEqual(failure);
  });

  it('does not echo a code or a platform it does not know', () => {
    expect(
      readConnectFailure({
        error: '<b>pwned</b>',
        platform: 'evil.example',
        vendor_message: 'Call 555-0100',
      }),
    ).toEqual({
      code: 'unknown',
      platform: null,
      vendorCode: null,
      vendorMessage: null,
      vendorLogId: null,
    });
  });

  it('shows no vendor text for a failure no vendor reported', () => {
    expect(
      readConnectFailure({
        error: 'state_expired',
        platform: 'youtube',
        vendor_code: 'x',
        vendor_message: 'Call 555-0100 to restore your account',
        vendor_log_id: 'x',
      }),
    ).toMatchObject({
      vendorCode: null,
      vendorMessage: null,
      vendorLogId: null,
    });
  });

  it('caps vendor text again on the way in, whatever the link says', () => {
    const failure = readConnectFailure({
      error: 'access_denied',
      platform: 'meta',
      vendor_code: 'c'.repeat(500),
      vendor_message: 'm'.repeat(5000),
    });

    expect(failure?.vendorCode).toHaveLength(65);
    expect(failure?.vendorMessage).toHaveLength(301);
  });

  it('understands the form the callbacks used to write', () => {
    expect(
      readConnectFailure({ error: 'tiktok_not_configured' }),
    ).toMatchObject({ code: 'not_configured', platform: 'tiktok' });
  });

  it('takes the first of a repeated parameter', () => {
    expect(
      readConnectFailure({ error: ['missing_params', 'access_denied'] }),
    ).toMatchObject({ code: 'missing_params' });
  });
});

describe('cleanVendorText', () => {
  it('is null for anything that is not text', () => {
    expect(cleanVendorText(undefined, 10)).toBeNull();
    expect(cleanVendorText({ toString: () => 'x' }, 10)).toBeNull();
    expect(cleanVendorText('  \n ', 10)).toBeNull();
  });

  it('flattens control characters and marks a cut', () => {
    expect(cleanVendorText('a\r\nb\u0000c\u2028d', 100)).toBe('a b c d');
    expect(cleanVendorText('abcdef', 3)).toBe('abc…');
  });
});

describe('accountIdFromUnverifiedState', () => {
  it('reads a UUID account and nothing else', () => {
    expect(
      accountIdFromUnverifiedState(encodeState({ accountId: ACCOUNT_ID })),
    ).toBe(ACCOUNT_ID);

    for (const accountId of ['https://evil.example/', '//evil.example', 7]) {
      expect(
        accountIdFromUnverifiedState(encodeState({ accountId })),
      ).toBeNull();
    }
  });

  it('is null for a state that is not ours', () => {
    expect(accountIdFromUnverifiedState(null)).toBeNull();
    expect(accountIdFromUnverifiedState('%%garbage%%')).toBeNull();
    expect(accountIdFromUnverifiedState(encodeState(null))).toBeNull();
    expect(accountIdFromUnverifiedState(encodeState('text'))).toBeNull();
  });
});

describe('connectFailurePath', () => {
  it('is the account’s platforms page for a slug', () => {
    expect(connectFailurePath('acme-films_2')).toBe(
      '/home/acme-films_2/settings/platforms',
    );
  });

  it.each([
    null,
    '',
    '//evil.example',
    '../../auth/sign-out',
    'a/b',
    'a?b',
    'a#b',
    'a\\b',
    'a b',
    'a%2Fb',
  ])(
    'is profile settings for a slug that could leave its path segment: %s',
    (slug) => {
      expect(connectFailurePath(slug)).toBe('/home/settings');
    },
  );

  // KB-99: `/home` redirects to a team and drops the query, so it can no
  // longer be where an unplaced failure is shown.
  it('is the create-team page for someone with no team', () => {
    expect(connectFailurePath(null, false)).toBe('/home/teams/create');
    expect(connectFailurePath('//evil.example', false)).toBe(
      '/home/teams/create',
    );
  });

  it('never falls back to /home', () => {
    expect(connectFailurePath(null)).not.toBe('/home');
    expect(connectFailurePath(null, false)).not.toBe('/home');
  });
});

describe('chooseAccountSlug', () => {
  const teams = [
    { id: ACCOUNT_ID, slug: 'acme' },
    { id: '11111111-2222-4333-8444-555555555555', slug: 'other' },
  ];

  it('prefers the workspace the connect was for', () => {
    expect(chooseAccountSlug(teams, ACCOUNT_ID)).toBe('acme');
  });

  it('takes the only workspace when there is no hint', () => {
    expect(chooseAccountSlug([teams[1]!], undefined)).toBe('other');
  });

  it('ignores a hint for a workspace this person is not in', () => {
    expect(
      chooseAccountSlug([teams[1]!], '99999999-9999-4999-8999-999999999999'),
    ).toBe('other');
    expect(chooseAccountSlug([teams[1]!], '//evil.example')).toBe('other');
  });

  it('chooses nothing when several workspaces are equally likely', () => {
    expect(chooseAccountSlug(teams, undefined)).toBeNull();
    expect(chooseAccountSlug([], ACCOUNT_ID)).toBeNull();
  });
});

describe('the message catalogue', () => {
  const { connectFailure } = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../../public/locales/en/platforms.json'),
      'utf8',
    ),
  ) as {
    connectFailure: {
      message: Record<string, string>;
      action: Record<string, string>;
    };
  };

  it('has a message and a next step for every code, and no strays', () => {
    const codes = [...CONNECT_FAILURE_CODES].sort();

    expect(Object.keys(connectFailure.message).sort()).toEqual(codes);
    expect(Object.keys(connectFailure.action).sort()).toEqual(codes);
  });

  it('says a refused scope may be an unapproved review', () => {
    expect(connectFailure.message.invalid_scope).toContain(
      'refused a permission this app asked for',
    );
    expect(connectFailure.message.invalid_scope).toContain(
      'review for that permission may not be approved yet',
    );
  });

  it('never puts markup in a message: Trans would render it', () => {
    for (const text of [
      ...Object.values(connectFailure.message),
      ...Object.values(connectFailure.action),
    ]) {
      expect(text).not.toMatch(/[<>]/);
    }
  });
});
