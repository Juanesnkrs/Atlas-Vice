import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

export const mailerConfigured = (): boolean => Boolean(env.SMTP_HOST);

export async function sendMagicLink(to: string, link: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
  });
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: 'Tu enlace de acceso a LeonidApp',
    text: `Entra a LeonidApp con este enlace (caduca en 15 minutos):\n${link}\n\nSi no lo pediste, ignora este correo.`,
  });
}
