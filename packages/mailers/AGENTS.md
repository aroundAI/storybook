# Email Service Instructions

This file contains guidance for working with the email service supporting multiple providers (vendor-agnostic).

## Email Provider Comparison

**Supported providers** (switch via `EMAIL_PROVIDER` environment variable):

| Provider | Free Tier | Cost (100K emails) | Best For | Setup Time |
|----------|-----------|-------------------|----------|------------|
| **Resend** | 3K/month | ~$160/month | Development, MVPs | 5 minutes |
| **AWS SES** | 62K/month (EC2) | $10/month | Production, scale | 1-2 days (domain verification) |
| **SendGrid** | 100/day | ~$90/month | Analytics, templates | 15 minutes |
| **Nodemailer** | Free | Free | SMTP, testing | 5 minutes |

**Recommended**: **Resend** for development → **AWS SES** for production scale.

### Configuration

```bash
# Option 1: Resend (Recommended for start)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_SENDER=noreply@your-domain.com

# Option 2: AWS SES (Recommended for production)
EMAIL_PROVIDER=ses
AWS_REGION=us-east-1
AWS_SES_CONFIG_SET=production
EMAIL_SENDER=noreply@your-domain.com

# Option 3: SendGrid
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
EMAIL_SENDER=noreply@your-domain.com

# Option 4: Nodemailer (SMTP)
EMAIL_PROVIDER=nodemailer
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

**Zero code changes** to switch providers - handled by `@kit/providers-email`.

### Lambda/Serverless Deployment

Email sending works seamlessly in serverless environments:

```typescript
// apps/web/lambda/email-worker/index.ts
// Processes SQS messages in AWS Lambda
// Automatic retry on failure (3 attempts)
// Dead letter queue for failed emails
```

**See**: `DEPLOYMENT.md` for email provider setup guides

## Basic Usage

```typescript
import { getMailer } from '@kit/mailers';
import { renderAccountDeleteEmail } from '@kit/email-templates';

async function sendSimpleEmail() {
    // Get mailer instance
  const mailer = await getMailer();

  // Send simple email
  await mailer.sendEmail({
    to: 'user@example.com',
    from: 'noreply@yourdomain.com', 
    subject: 'Welcome!',
    html: '<h1>Welcome!</h1><p>Thank you for joining us.</p>',
  });
}

async function sendComplexEmail() {
  // Send with email template
  const { html, subject } = await renderAccountDeleteEmail({
    userDisplayName: user.name,
    productName: 'My SaaS App',
  });

  await mailer.sendEmail({
    to: user.email,
    from: 'noreply@yourdomain.com',
    subject,
    html,
  });
}
```

## Email Templates

Email templates are located in `@kit/email-templates` and return `{ html, subject }`:

```typescript
import { 
  renderAccountDeleteEmail,
  renderWelcomeEmail,
  renderPasswordResetEmail 
} from '@kit/email-templates';

// Render template
const { html, subject } = await renderWelcomeEmail({
  userDisplayName: 'John Doe',
  loginUrl: 'https://app.com/login'
});

// Send rendered email
const mailer = await getMailer();

await mailer.sendEmail({
  to: user.email,
  from: 'welcome@yourdomain.com',
  subject,
  html,
});
```