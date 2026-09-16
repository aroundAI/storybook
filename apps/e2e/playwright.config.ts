import { defineConfig, devices } from '@playwright/test';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
dotenvConfig({ path: '.env.local' });

const enableBillingTests = process.env.ENABLE_BILLING_TESTS === 'true';
const enableTeamAccountTests =
  (process.env.ENABLE_TEAM_ACCOUNT_TESTS ?? 'true') === 'true';

const testIgnore: string[] = [];

if (!enableBillingTests) {
  console.log(
    `Billing tests are disabled. To enable them, set the environment variable ENABLE_BILLING_TESTS=true.`,
    `Current value: "${process.env.ENABLE_BILLING_TESTS}"`,
  );

  testIgnore.push('*-billing.spec.ts');
}

if (!enableTeamAccountTests) {
  console.log(
    `Team account tests are disabled. To enable them, set the environment variable ENABLE_TEAM_ACCOUNT_TESTS=true.`,
    `Current value: "${process.env.ENABLE_TEAM_ACCOUNT_TESTS}"`,
  );

  testIgnore.push('*team-accounts.spec.ts');
  testIgnore.push('*invitations.spec.ts');
  testIgnore.push('*team-billing.spec.ts');
  // The revenue specs seed through `create_team_account`, which raises
  // 'Team accounts are not enabled' when the feature is off — so without
  // this they do not skip, they fail at setup for a reason that has
  // nothing to do with revenue.
  testIgnore.push('*revenue*.spec.ts');
}

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  retries: 3,
  /* Limit parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Ignore billing tests if the environment variable is not set. */
  testIgnore,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /*
     * Base URL to use in actions like `await page.goto('/')`.
     *
     * Overridable so a run can target a server other than whatever holds
     * port 3000 — a long-lived dev server goes stale (its Supabase client
     * and compiled routes outlive a `supabase stop`), and the failure mode
     * is every signup silently not sending mail, which reads as a broken
     * test rather than a broken server.
     */
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',

    // take a screenshot when a test fails
    screenshot: 'only-on-failure',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    navigationTimeout: 15 * 1000,
  },
  // test timeout set to 2 minutes
  timeout: 120 * 1000,
  expect: {
    // expect timeout set to 10 seconds
    timeout: 10 * 1000,
  },
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: process.env.PLAYWRIGHT_SERVER_COMMAND
    ? {
        cwd: '../../',
        command: process.env.PLAYWRIGHT_SERVER_COMMAND,
        url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
