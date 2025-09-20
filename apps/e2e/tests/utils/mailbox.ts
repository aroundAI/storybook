import { Page } from '@playwright/test';
import { parse } from 'node-html-parser';

type MessageSummary = {
  ID: string;
  MessageID: string;
  Read: boolean;
  From: {
    Name: string;
    Address: string;
  };
  To: Array<{
    Name: string;
    Address: string;
  }>;
  Cc: Array<any>;
  Bcc: Array<any>;
  ReplyTo: Array<any>;
  Subject: string;
  Created: string;
  Tags: Array<any>;
  Size: number;
  Attachments: number;
  Snippet: string;
};

type MessagesResponse = {
  total: number;
  unread: number;
  count: number;
  messages_count: number;
  start: number;
  tags: Array<any>;
  messages: MessageSummary[];
};

/**
 * Mailbox class for interacting with the Mailpit mailbox API.
 */
export class Mailbox {
  static URL = 'http://127.0.0.1:54324';

  constructor(private readonly page: Page) {}

  async visitMailbox(
    email: string,
    params: {
      deleteAfter: boolean;
      subject?: string;
    },
  ) {
    console.log(`Visiting mailbox ${email} ...`);

    if (!email) {
      throw new Error('Invalid email');
    }

    const json = await this.getEmail(email, params);

    if (!json) {
      throw new Error('Email body was not found');
    }

    console.log(`Email found for email: ${email}`, {
      expectedEmail: email,
      id: json.ID,
      subject: json.Subject,
      date: json.Date,
      to: json.To[0],
      text: json.Text,
    });

    if (email !== json.To[0]!.Address) {
      throw new Error(`Email address mismatch. Expected ${email}, got ${json.To[0]!.Address}`);
    }

    const el = parse(json.HTML);

    const linkHref = el.querySelector('a')?.getAttribute('href');

    if (!linkHref) {
      throw new Error('No link found in email');
    }

    console.log(`Visiting ${linkHref} from mailbox ${email}...`);

    return this.page.goto(linkHref);
  }

  /**
   * Retrieves an OTP code from an email
   * @param email The email address to check for the OTP
   * @param deleteAfter Whether to delete the email after retrieving the OTP
   * @returns The OTP code
   */
  async getOtpFromEmail(email: string, deleteAfter = false) {
    console.log(`Retrieving OTP from mailbox ${email} ...`);

    if (!email) {
      throw new Error('Invalid email');
    }

    const json = await this.getEmail(email, {
      deleteAfter,
      subject: `One-time password for`,
    });

    if (!json) {
      throw new Error('Email body was not found');
    }

    if (email !== json.To[0]!.Address) {
      throw new Error(`Email address mismatch. Expected ${email}, got ${json.To[0]!.Address}`);
    }

    const text = json.HTML.match(
      new RegExp(`Your one-time password is: (\\d{6})`),
    )?.[1];

    if (text) {
      console.log(`OTP code found in text: ${text}`);
      return text;
    }

    throw new Error('Could not find OTP code in email');
  }

  async getEmail(
    email: string,
    params: {
      deleteAfter: boolean;
      subject?: string;
    },
  ) {
    console.log(`Retrieving email from mailbox ${email}...`);

    const url = `${Mailbox.URL}/api/v1/search?query=to:${email}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch emails: ${response.statusText}`);
    }

    const messagesResponse = (await response.json()) as MessagesResponse;

    if (!messagesResponse || !messagesResponse.messages?.length) {
      console.log(`No emails found for mailbox ${email}`);

      return;
    }

    const message = params.subject
      ? (() => {
          const filtered = messagesResponse.messages.filter(
            (item) => item.Subject.includes(params.subject!),
          );

          console.log(
            `Found ${filtered.length} emails with subject ${params.subject}`,
          );

          // retrieve the latest by timestamp
          return filtered.reduce((acc, item) => {
            if (
              new Date(acc.Created).getTime() < new Date(item.Created).getTime()
            ) {
              return item;
            }

            return acc;
          });
        })()
      : messagesResponse.messages.reduce((acc, item) => {
          if (
            new Date(acc.Created).getTime() < new Date(item.Created).getTime()
          ) {
            return item;
          }

          return acc;
        });

    if (!message) {
      throw new Error('No message found');
    }

    const messageId = message.ID;
    const messageUrl = `${Mailbox.URL}/api/v1/message/${messageId}`;

    const messageResponse = await fetch(messageUrl);

    if (!messageResponse.ok) {
      throw new Error(`Failed to fetch email: ${messageResponse.statusText}`);
    }

    // delete message
    if (params.deleteAfter) {
      console.log(`Deleting email ${messageId} ...`);

      const res = await fetch(`${Mailbox.URL}/api/v1/messages`, {
        method: 'DELETE',
        body: JSON.stringify({ Ids: [messageId] }),
      });

      if (!res.ok) {
        console.error(`Failed to delete email: ${res.statusText}`);
      }
    }

    return (await messageResponse.json()) as Promise<{
      ID: string;
      MessageID: string;
      From: {
        Name: string;
        Address: string;
      };
      To: Array<{
        Name: string;
        Address: string;
      }>;
      Cc: Array<any>;
      Bcc: Array<any>;
      ReplyTo: Array<any>;
      ReturnPath: string;
      Subject: string;
      ListUnsubscribe: {
        Header: string;
        Links: Array<any>;
        Errors: string;
        HeaderPost: string;
      };
      Date: string;
      Tags: Array<any>;
      Text: string;
      HTML: string;
      Size: number;
      Inline: Array<any>;
      Attachments: Array<any>;
    }>;
  }
}