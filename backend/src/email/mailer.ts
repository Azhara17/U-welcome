import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: EmailMessage): Promise<void>;
}

export function createSmtpMailer(opts: { host: string; port: number; from: string }): Mailer {
  const transport = nodemailer.createTransport({ host: opts.host, port: opts.port, secure: false });
  return {
    async send(msg) {
      await transport.sendMail({ from: opts.from, ...msg });
    },
  };
}
