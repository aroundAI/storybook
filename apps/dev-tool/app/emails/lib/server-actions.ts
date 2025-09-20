'use server';

import { loadEmailTemplate } from '@/app/emails/lib/email-loader';

export async function sendEmailAction(params: {
  template: string;
  settings: {
    username: string;
    password: string;
    sender: string;
    host: string;
    to: string;
    port: number;
    tls: boolean;
  };
}) {
  const { settings } = params;
  const { createTransport } = await import('nodemailer');

  const transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.tls,
    auth: {
      user: settings.username,
      pass: settings.password,
    },
  });

  const { html } = await loadEmailTemplate(params.template);

  return transporter.sendMail({
    html,
    from: settings.sender,
    to: settings.to,
    subject: 'Test Email',
  });
}
