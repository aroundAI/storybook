import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:cookiePolicy'),
  };
}

async function CookiePolicyPage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'January 7, 2025';
  const companyName = 'Around AI Limited';
  const productName = 'StoryBook';
  const website = 'storybook.digital';
  const contactEmail = 'privacy@storybook.digital';

  return (
    <div>
      <SitePageHeader
        title={t(`marketing:cookiePolicy`)}
        subtitle={t(`marketing:cookiePolicyDescription`)}
      />

      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <p className="text-muted-foreground text-sm">
            Last updated: {lastUpdated}
          </p>

          <h2>1. What Are Cookies?</h2>
          <p>
            Cookies are small text files stored on your device when you visit a website.
            They help websites remember your preferences, understand how you use the site,
            and provide a personalized experience. {productName} uses cookies and similar
            technologies to operate and improve our Service.
          </p>

          <h2>2. Types of Cookies We Use</h2>

          <h3>2.1 Essential Cookies</h3>
          <p>
            These cookies are necessary for the Service to function and cannot be disabled.
          </p>
          <table className="w-full">
            <thead>
              <tr>
                <th>Cookie Name</th>
                <th>Purpose</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>sb-access-token</code></td>
                <td>Authentication - keeps you signed in</td>
                <td>Session / 7 days</td>
              </tr>
              <tr>
                <td><code>sb-refresh-token</code></td>
                <td>Authentication - refreshes your session</td>
                <td>7 days</td>
              </tr>
              <tr>
                <td><code>__Host-next-auth.csrf-token</code></td>
                <td>Security - prevents cross-site request forgery</td>
                <td>Session</td>
              </tr>
              <tr>
                <td><code>supabase-auth-token</code></td>
                <td>Authentication state</td>
                <td>Session</td>
              </tr>
            </tbody>
          </table>

          <h3>2.2 Functional Cookies</h3>
          <p>
            These cookies enable enhanced functionality and personalization.
          </p>
          <table className="w-full">
            <thead>
              <tr>
                <th>Cookie Name</th>
                <th>Purpose</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>theme</code></td>
                <td>Remembers your light/dark mode preference</td>
                <td>1 year</td>
              </tr>
              <tr>
                <td><code>locale</code></td>
                <td>Remembers your language preference</td>
                <td>1 year</td>
              </tr>
              <tr>
                <td><code>sidebar-collapsed</code></td>
                <td>Remembers your sidebar state</td>
                <td>1 year</td>
              </tr>
            </tbody>
          </table>

          <h3>2.3 Analytics Cookies</h3>
          <p>
            These cookies help us understand how visitors interact with the Service.
          </p>
          <table className="w-full">
            <thead>
              <tr>
                <th>Cookie Name</th>
                <th>Provider</th>
                <th>Purpose</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>_ga</code>, <code>_gid</code></td>
                <td>Google Analytics</td>
                <td>Usage analytics</td>
                <td>2 years / 24 hours</td>
              </tr>
            </tbody>
          </table>

          <h3>2.4 Third-Party Cookies</h3>
          <p>
            When you connect external platforms, those services may set their own cookies:
          </p>
          <ul>
            <li><strong>YouTube:</strong> For video embedding and publishing</li>
            <li><strong>Stripe:</strong> For payment processing (fraud prevention)</li>
            <li><strong>Sentry:</strong> For error tracking and debugging</li>
          </ul>
          <p>
            We have no control over third-party cookies. Please refer to each provider&apos;s
            cookie policy for more information.
          </p>

          <h2>3. Local Storage and Session Storage</h2>
          <p>
            In addition to cookies, we use browser storage technologies:
          </p>
          <table className="w-full">
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>supabase.auth.token</code></td>
                <td>Local Storage</td>
                <td>Authentication state</td>
              </tr>
              <tr>
                <td><code>react-query-cache</code></td>
                <td>Session Storage</td>
                <td>API response caching for performance</td>
              </tr>
              <tr>
                <td><code>workspace-preferences</code></td>
                <td>Local Storage</td>
                <td>Workspace settings</td>
              </tr>
            </tbody>
          </table>

          <h2>4. Managing Cookies</h2>

          <h3>4.1 Browser Settings</h3>
          <p>
            Most browsers allow you to manage cookies through their settings:
          </p>
          <ul>
            <li><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</li>
            <li><strong>Firefox:</strong> Options → Privacy &amp; Security → Cookies</li>
            <li><strong>Safari:</strong> Preferences → Privacy → Cookies</li>
            <li><strong>Edge:</strong> Settings → Privacy → Cookies</li>
          </ul>

          <h3>4.2 Consequences of Disabling Cookies</h3>
          <p>
            If you disable essential cookies, you may experience:
          </p>
          <ul>
            <li>Inability to sign in or stay signed in</li>
            <li>Loss of personalization settings</li>
            <li>Reduced functionality of certain features</li>
          </ul>

          <h3>4.3 Opt-Out Links</h3>
          <ul>
            <li>
              <strong>Google Analytics:</strong>{' '}
              <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">
                Google Analytics Opt-out Browser Add-on
              </a>
            </li>
          </ul>

          <h2>5. Do Not Track</h2>
          <p>
            Some browsers send a &quot;Do Not Track&quot; (DNT) signal. Currently, there is no
            industry standard for responding to DNT signals. We currently do not respond
            to DNT signals, but we limit tracking to what is necessary for the Service.
          </p>

          <h2>6. Cookie Consent</h2>
          <p>
            When you first visit {productName}, we may display a cookie banner requesting
            your consent for non-essential cookies. Your consent preferences are stored and
            you can update them at any time through your account settings.
          </p>

          <h2>7. Updates to This Policy</h2>
          <p>
            We may update this Cookie Policy from time to time. Changes will be posted
            on this page with an updated &quot;Last updated&quot; date. Material changes will be
            communicated through the Service or via email.
          </p>

          <h2>8. Contact Us</h2>
          <p>
            If you have questions about our use of cookies, please contact us:
          </p>
          <ul>
            <li>Email: <a href={`mailto:${contactEmail}`}>{contactEmail}</a></li>
            <li>Website: <a href={`https://${website}`}>{website}</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default withI18n(CookiePolicyPage);
