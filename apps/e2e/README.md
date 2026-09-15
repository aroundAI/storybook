# E2E Testing Suite

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

End-to-end testing suite using Playwright to ensure the web application works correctly from a user's perspective. Tests cover critical user journeys, authentication flows, and core SaaS functionality.

## Purpose

This testing suite provides:
- **User journey testing**: Complete user workflows from registration to feature usage
- **Cross-browser testing**: Ensure compatibility across different browsers
- **Authentication testing**: Login, signup, and session management
- **Payment flow testing**: Billing and subscription workflows
- **Team functionality testing**: Multi-tenant features and permissions
- **Regression testing**: Prevent breaking changes to core functionality

## Technology Stack

- **Playwright**: Modern end-to-end testing framework
- **TypeScript**: Type-safe test development
- **Test fixtures**: Reusable test setup and teardown

## Available Scripts

### `test`
```bash
pnpm --filter e2e test
```
Runs the full test suite in headless mode

### `test:ui`
```bash
pnpm --filter e2e test:ui
```
Runs tests with Playwright UI for debugging

### `test:headed`
```bash
pnpm --filter e2e test:headed
```
Runs tests in headed mode (visible browser)

### `test:debug`
```bash
pnpm --filter e2e test:debug
```
Runs tests in debug mode with step-by-step execution

## Test Categories

### Authentication Tests
- User registration flow
- Email verification
- Login and logout
- Password reset
- Account settings

### Team Management Tests
- Team creation
- Member invitations
- Role management
- Team switching

### Billing Tests
- Subscription creation
- Payment processing
- Plan upgrades/downgrades
- Billing portal access

### Feature Tests
- Dashboard functionality
- Core SaaS features
- Settings management
- Data operations

## Running Tests

### Prerequisites

1. **Start the web application**:
```bash
pnpm --filter web dev
```

2. **Ensure test database is running**:
```bash
pnpm supabase:web:start
```

3. **Set up test environment variables**:
```bash
# .env.local in apps/e2e
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=testpassword123
BASE_URL=http://localhost:3000
```

### Run All Tests

```bash
pnpm --filter e2e test
```

### Run Specific Test File

```bash
pnpm --filter e2e test auth.spec.ts
```

### Run Tests in Debug Mode

```bash
pnpm --filter e2e test:debug
```

## Writing Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test('user can sign up', async ({ page }) => {
  await page.goto('/auth/sign-up');

  await page.fill('[data-test="email-input"]', 'user@example.com');
  await page.fill('[data-test="password-input"]', 'password123');
  await page.click('[data-test="signup-button"]');

  await expect(page).toHaveURL('/auth/verify-email');
});
```

### Using Test Fixtures

```typescript
import { test as base } from '@playwright/test';

type TestFixtures = {
  authenticatedPage: Page;
};

const test = base.extend<TestFixtures>({
  authenticatedPage: async ({ page }, use) => {
    await page.goto('/auth/sign-in');
    await page.fill('[data-test="email"]', 'user@example.com');
    await page.fill('[data-test="password"]', 'password123');
    await page.click('[data-test="sign-in-button"]');
    await page.waitForURL('/home');

    await use(page);
  },
});

test('authenticated user can access dashboard', async ({ authenticatedPage }) => {
  await expect(authenticatedPage).toHaveURL('/home');
});
```

### Best Practices

1. **Use data-test attributes**: Target elements with specific test attributes
2. **Wait for network idle**: Ensure async operations complete
3. **Clean up test data**: Remove test data after each test
4. **Use page object model**: Organize tests with reusable page classes
5. **Test error scenarios**: Include negative test cases

## Test Data Management

### Test User Setup

```typescript
// fixtures/test-users.ts
export const testUsers = {
  standard: {
    email: 'user@example.com',
    password: 'password123',
  },
  admin: {
    email: 'admin@example.com',
    password: 'adminpass123',
  },
};
```

### Database Cleanup

```typescript
// Setup and teardown
test.beforeEach(async () => {
  await cleanupTestData();
});

test.afterEach(async () => {
  await cleanupTestData();
});
```

## CI/CD Integration

### GitHub Actions

```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: pnpm install
      - run: pnpm --filter web build
      - run: pnpm --filter e2e test
```

## Debugging Tests

### Visual Debugging

```bash
# Run with UI for visual debugging
pnpm --filter e2e test:ui

# Run in headed mode
pnpm --filter e2e test:headed
```

### Screenshots and Videos

Playwright automatically captures:
- Screenshots on test failure
- Videos of test execution
- Traces for debugging

Files are saved in `test-results/` directory.

## Configuration

### Playwright Config

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 2,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

## Project Structure

```
apps/e2e/
├── tests/
│   ├── auth/          # Authentication tests
│   ├── billing/       # Payment and billing tests
│   ├── teams/         # Team management tests
│   └── features/      # Core feature tests
├── fixtures/      # Test fixtures and utilities
├── page-objects/  # Page object model classes
├── test-results/  # Test output (screenshots, videos)
├── playwright.config.ts
├── package.json
└── README.md
```

## Environment Variables

```bash
# Test configuration
BASE_URL=http://localhost:3000
TEST_USER_EMAIL=test@example.com
TEST_USER_PASSWORD=testpassword123

# Optional: headless mode override
HEADED=false

# Optional: browser selection
BROWSER=chromium
```

## Proving a UI fix with a browser test

> Part of [docs/ENGINEERING-WORKFLOW.md](../../docs/ENGINEERING-WORKFLOW.md),
> which covers why this layer exists and what the others cannot see.

Four consecutive review rounds on FILM-1609 found bugs in one form that
typecheck, lint and 256 unit tests all passed. They had one thing in
common: they lived between the DOM and form state, where only a browser
looks. `tests/revenue/` is the worked example of covering that class.

### Seed the account through the API, not the UI

`tests/utils/seed.ts` creates a confirmed user and a team account by
calling Supabase directly, then the test signs in and goes straight to the
page under test.

```ts
const account = await seedTeamAccount();   // user + team, confirmed
await this.auth.goToSignIn();
await this.auth.signIn(account);
await this.page.goto(`/home/${account.slug}/studio/analytics`);
```

Driving sign-up → confirmation mail → account selector → create-team
dialog first means a revenue test fails for four reasons that have nothing
to do with revenue, and two of those flows are the ones the admin and
invitation specs already flake on. It is also roughly 20× slower: the
revenue suite runs eight specs in 26s seeded, against 90s *timeouts*
through the UI.

Seed with the product's own entry points (`create_team_account` rather than
inserting rows) so the fixture cannot drift from what the app creates.

### Assert the second submission, not the first

Most state bugs are invisible on a fresh form. They appear after a reset,
when the DOM and form state disagree:

```ts
await revenue.addEntry({ dollars: '250.00', category: 'Licensing' });
await revenue.expectSuccessToast();

// Shipped bug: the field kept "250.00" while form state held 0, so the
// next save wrote a zero row and reported success.
await expect(revenue.amountInput()).toHaveValue('');
```

### Prove the guard fails without the fix

A test that passes on fixed code has proved nothing. Revert the fix, watch
the test go red, restore it:

```bash
# revert .min(1) -> .min(0), then:
npx playwright test revenue -g "refuses a blank amount"   # must FAIL
```

Do this for every guard you add. Three of the revenue specs were verified
this way, and the exercise is what distinguishes a regression test from a
test that happens to be green.

### Fixed waits, and why they are still here

`AuthPageObject.signIn` and `signUp` wait a flat 500ms before typing, and
~10 other `waitForTimeout` calls sit in `billing.po.ts`, `account.po.ts`,
`otp.po.ts`, `team-accounts.po.ts` and `admin.spec.ts`. A fixed wait is a bet
that the page is ready, and the right shape is a wait on a signal.

**Three attempts to replace the sign-in ones made CI worse and were reverted**
(2 flaky → 5 flaky → an aborted run). The original flake was never reproduced
locally, so each change was a guess dressed as a fix. If you take this on:
reproduce the failure first, change one helper, and read the CI flake count
before changing a second. The history is in PR #256 and the lesson is in
[docs/ENGINEERING-WORKFLOW.md](../../docs/ENGINEERING-WORKFLOW.md).

### Run it the way CI does

```bash
# production build + production server + the full suite, as CI runs it
pnpm --filter web-e2e test:prod

# on a busy port
PORT=3100 PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm --filter web-e2e test:prod
```

`test:prod` is `build:test` → `start:test` → `playwright test`, the same three
steps as the CI job, with Playwright owning the server through
`PLAYWRIGHT_SERVER_COMMAND` so it is torn down with the run. Use it before
claiming the suite is fine; `pnpm dev` compiles on demand and gives different
answers.

### Point a run at your own server

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test revenue
```

A dev server left running for days goes stale — its Supabase client and
compiled routes outlive a `supabase stop`. The symptom is that every signup
silently sends no mail and every test hangs at the confirmation step, which
reads as a broken test rather than a broken server. If auth email stops
arriving, restart the dev server before debugging the suite.

### Capturing screenshots for a PR — required for UI changes

**A PR that changes what a user sees must show what they now see.** This is
a requirement, not a nicety: FILM-1609 spent six text-only review rounds on
a form that could not be submitted, and one screenshot of it after a save
would have ended that at round one.

Capture the state *after* the action as well as before — the reset-and-
rerender case is where this repo's UI bugs have lived — and include the
error states, which are invisible in a diff.

`tests/revenue/revenue-evidence.spec.ts` is the pattern: a spec that is
skipped unless `CAPTURE_EVIDENCE=1`, so it costs CI nothing, and that
measures its claims in the DOM rather than asserting them by eye.

```bash
CAPTURE_EVIDENCE=1 EVIDENCE_DIR=/tmp/evidence \
  PLAYWRIGHT_BASE_URL=http://localhost:3100 \
  npx playwright test revenue-evidence
```

Attach them with `gh --attach` (gh 2.99.0+; this repo is on 2.100.0) rather
than dragging them into the web UI:

```bash
gh pr comment 256 \
  --body-file body.md \
  --attach "/abs/path/02-blank-amount.png#The form refusing a blank amount"
```

The path given to `--attach` must match the `![alt](<path>)` reference in the
body exactly, or `gh` appends the upload at the end and leaves the inline
reference broken. Check afterwards — a broken image renders as alt text and
reads as fine at a glance:

```bash
gh pr view 256 --json comments --jq '.comments[-1].body' \
  | grep -oE '!\[[^]]*\]\([^)]+\)'
```

Put the measured table in the comment text, where it is reviewable and
greppable, and let the screenshots illustrate it.

## Contributing

When adding new tests:

1. **Follow naming conventions**: Use descriptive test names
2. **Add data-test attributes**: Ensure new UI elements are testable
3. **Update test documentation**: Document new test scenarios
4. **Test locally**: Run tests before submitting PR
5. **Consider edge cases**: Test both success and failure scenarios

---

*Last updated: September 20, 2025*
