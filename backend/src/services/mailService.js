import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter = null;

function getTransporter() {
  if (!env.smtp.host) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user
        ? {
            user: env.smtp.user,
            pass: env.smtp.pass,
          }
        : undefined,
    });
  }
  return transporter;
}

/**
 * Sends transactional email via configured SMTP, or logs cleanly in development
 * when SMTP credentials are not configured.
 */
export async function sendMail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    if (!env.isProduction) {
      console.log(`[DEV MAIL] To: ${to} | Subject: ${subject}\n${text}`);
      return { delivered: false, devLogged: true };
    }
    throw new Error('SMTP transport is not configured in production.');
  }

  const info = await mailer.sendMail({
    from: env.smtp.from,
    to,
    subject,
    text,
    html,
  });

  return { delivered: true, messageId: info.messageId };
}

