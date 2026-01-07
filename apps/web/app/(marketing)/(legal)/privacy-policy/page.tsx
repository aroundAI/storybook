import { SitePageHeader } from '~/(marketing)/_components/site-page-header';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

export async function generateMetadata() {
  const { t } = await createI18nServerInstance();

  return {
    title: t('marketing:privacyPolicy'),
  };
}

async function PrivacyPolicyPage() {
  const { t } = await createI18nServerInstance();
  const lastUpdated = 'January 7, 2025';
  const companyName = 'Around AI Limited';
  const productName = 'StoryBook';
  const website = 'storybook.digital';
  const contactEmail = 'privacy@storybook.digital';

  return (
    <div>
      <SitePageHeader
        title={t('marketing:privacyPolicy')}
        subtitle={t('marketing:privacyPolicyDescription')}
      />

      <div className="container mx-auto max-w-4xl px-4 py-8">
        <div className="prose prose-slate dark:prose-invert max-w-none">
          <p className="text-muted-foreground text-sm">
            Last updated: {lastUpdated}
          </p>

          <h2>1. Introduction</h2>
          <p>
            {companyName} (&quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) respects your privacy and is
            committed to protecting your personal data. This Privacy Policy explains how we collect,
            use, disclose, and safeguard your information when you use {productName} (&quot;the Service&quot;).
          </p>

          <h2>2. Information We Collect</h2>

          <h3>2.1 Information You Provide</h3>
          <table className="w-full">
            <thead>
              <tr>
                <th>Data Type</th>
                <th>Purpose</th>
                <th>Legal Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Account Information (email, name, password)</td>
                <td>Account creation and authentication</td>
                <td>Contract performance</td>
              </tr>
              <tr>
                <td>Profile Information (avatar, preferences)</td>
                <td>Personalization</td>
                <td>Consent</td>
              </tr>
              <tr>
                <td>Payment Information</td>
                <td>Billing and subscriptions</td>
                <td>Contract performance</td>
              </tr>
              <tr>
                <td>User Content (stories, characters, media)</td>
                <td>Service delivery</td>
                <td>Contract performance</td>
              </tr>
              <tr>
                <td>Communications</td>
                <td>Customer support</td>
                <td>Legitimate interest</td>
              </tr>
            </tbody>
          </table>

          <h3>2.2 Information Collected Automatically</h3>
          <ul>
            <li><strong>Device Information:</strong> Browser type, operating system, device identifiers</li>
            <li><strong>Usage Data:</strong> Pages visited, features used, time spent on the Service</li>
            <li><strong>Log Data:</strong> IP address, access times, error logs</li>
            <li><strong>Cookies:</strong> See our <a href="/cookie-policy">Cookie Policy</a> for details</li>
          </ul>

          <h3>2.3 Information from Third Parties</h3>
          <p>When you connect third-party platforms, we receive:</p>
          <ul>
            <li><strong>OAuth Providers (Google, GitHub):</strong> Basic profile information for sign-in</li>
            <li><strong>Social Media Platforms (YouTube, TikTok, Instagram, Facebook, Twitter, LinkedIn):</strong>
              <ul>
                <li>Account name and profile picture</li>
                <li>Channel/page IDs for publishing</li>
                <li>Analytics data (views, likes, watch time)</li>
                <li>Follower counts</li>
              </ul>
            </li>
            <li><strong>Payment Processors (Stripe, Lemon Squeezy):</strong> Transaction status (not full card details)</li>
          </ul>

          <h2>3. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul>
            <li>Provide and maintain the Service</li>
            <li>Process your transactions and subscriptions</li>
            <li>Send you service-related communications</li>
            <li>Improve and personalize your experience</li>
            <li>Analyze usage patterns and trends</li>
            <li>Detect and prevent fraud or abuse</li>
            <li>Comply with legal obligations</li>
            <li>Publish content to connected platforms on your behalf</li>
            <li>Sync analytics from connected platforms</li>
          </ul>

          <h2>4. AI Processing</h2>
          <h3>4.1 How AI Uses Your Data</h3>
          <p>
            We use third-party AI providers to power our features. When you use AI features,
            your prompts and content may be processed by:
          </p>
          <ul>
            <li><strong>Language Models:</strong> OpenAI, Anthropic, Google (Gemini), Deepseek</li>
            <li><strong>Video Generation:</strong> Kling, Hailuo, Runway</li>
            <li><strong>Voice Synthesis:</strong> ElevenLabs, PlayHT</li>
            <li><strong>Music Generation:</strong> Suno</li>
          </ul>

          <h3>4.2 AI Training</h3>
          <p>
            We use providers that do not train their models on your data by default.
            Your content is processed solely to provide the requested output and is not
            used to improve third-party AI models.
          </p>

          <h3>4.3 AI Output</h3>
          <p>
            AI-generated content may contain inaccuracies or inappropriate material.
            You are responsible for reviewing all AI outputs before use or publication.
          </p>

          <h2>5. Data Sharing and Disclosure</h2>
          <p>We may share your information with:</p>

          <h3>5.1 Service Providers</h3>
          <table className="w-full">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Purpose</th>
                <th>Location</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Supabase</td>
                <td>Database, Authentication</td>
                <td>AWS (US/EU)</td>
              </tr>
              <tr>
                <td>AWS</td>
                <td>Hosting, Storage</td>
                <td>US</td>
              </tr>
              <tr>
                <td>Stripe / Lemon Squeezy</td>
                <td>Payment processing</td>
                <td>US</td>
              </tr>
              <tr>
                <td>Resend</td>
                <td>Transactional emails</td>
                <td>US</td>
              </tr>
              <tr>
                <td>Sentry</td>
                <td>Error tracking</td>
                <td>US</td>
              </tr>
            </tbody>
          </table>

          <h3>5.2 Connected Platforms</h3>
          <p>
            When you connect your social media accounts, we share content you publish
            through those platforms according to your instructions.
          </p>

          <h3>5.3 Legal Requirements</h3>
          <p>
            We may disclose your information if required by law, court order, or
            governmental authority, or to protect our rights and safety.
          </p>

          <h2>6. Data Retention</h2>
          <ul>
            <li><strong>Account Data:</strong> Retained while your account is active, plus 30 days after deletion request</li>
            <li><strong>User Content:</strong> Retained until you delete it or close your account</li>
            <li><strong>Analytics Data:</strong> Retained for 24 months</li>
            <li><strong>Payment Records:</strong> Retained for 7 years (legal requirement)</li>
            <li><strong>Server Logs:</strong> Retained for 30 days</li>
          </ul>

          <h2>7. Your Rights</h2>
          <p>Depending on your location, you may have the right to:</p>
          <ul>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Rectification:</strong> Correct inaccurate data</li>
            <li><strong>Erasure:</strong> Request deletion of your data (&quot;right to be forgotten&quot;)</li>
            <li><strong>Portability:</strong> Receive your data in a structured format</li>
            <li><strong>Restriction:</strong> Limit how we process your data</li>
            <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
            <li><strong>Withdraw Consent:</strong> Revoke consent where applicable</li>
          </ul>
          <p>
            To exercise these rights, contact us at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            We will respond within 30 days.
          </p>

          <h2>8. Data Security</h2>
          <p>We implement industry-standard security measures including:</p>
          <ul>
            <li>Encryption in transit (TLS 1.3) and at rest</li>
            <li>Row-Level Security (RLS) in our database</li>
            <li>Regular security audits</li>
            <li>Access controls and authentication</li>
            <li>Secure credential storage (never stored in plain text)</li>
            <li>OAuth tokens encrypted at rest</li>
          </ul>
          <p>
            However, no method of transmission over the Internet is 100% secure.
            We cannot guarantee absolute security.
          </p>

          <h2>9. International Transfers</h2>
          <p>
            Your data may be transferred to and processed in countries outside your jurisdiction,
            including the United States. We ensure appropriate safeguards are in place, including
            Standard Contractual Clauses where applicable.
          </p>

          <h2>10. Children&apos;s Privacy</h2>
          <p>
            The Service is not intended for users under 18 years of age. We do not knowingly
            collect personal information from children. If you believe we have collected data
            from a minor, please contact us immediately.
          </p>

          <h2>11. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of material
            changes via email or through the Service. Continued use after changes constitutes
            acceptance of the updated policy.
          </p>

          <h2>12. Contact Us</h2>
          <p>For privacy-related inquiries:</p>
          <ul>
            <li>Email: <a href={`mailto:${contactEmail}`}>{contactEmail}</a></li>
            <li>Website: <a href={`https://${website}`}>{website}</a></li>
          </ul>

          <h2>13. Additional Disclosures</h2>

          <h3>For California Residents (CCPA)</h3>
          <p>
            California residents have additional rights under the California Consumer Privacy Act.
            You may request disclosure of the categories and specific pieces of personal information
            we have collected, and request deletion of your data. We do not sell your personal information.
          </p>

          <h3>For EU/EEA Residents (GDPR)</h3>
          <p>
            If you are in the EU/EEA, {companyName} acts as the data controller for your personal data.
            You have the right to lodge a complaint with your local data protection authority
            if you believe your rights have been violated.
          </p>
        </div>
      </div>
    </div>
  );
}

export default withI18n(PrivacyPolicyPage);
