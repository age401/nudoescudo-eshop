/**
 * Email abstraction. EMAIL_MODE selects the driver:
 *  - 'smtp'    : any SMTP server (dev: Mailpit on localhost:1025)
 *  - 'resend'  : Resend HTTP API (production)
 *  - 'console' : log to stdout (tests / last resort)
 */
import { env, loadEnv } from "@/lib/env";

loadEnv();

export type Mail = { to: string; subject: string; html: string };

/**
 * Test mode: when MAIL_REDIRECT_TO is set, every message goes to that address
 * instead of the real recipient, with the intended one kept in the subject so
 * a full order flow can be walked end to end from a single inbox. Leave it
 * empty in production.
 */
function applyRedirect(mail: Mail): Mail {
  const to = process.env.MAIL_REDIRECT_TO?.trim();
  if (!to || to === mail.to) return mail;
  return {
    ...mail,
    to,
    subject: `[test → ${mail.to}] ${mail.subject}`,
  };
}

export async function sendMail(input: Mail): Promise<void> {
  const mail = applyRedirect(input);
  const mode = env("EMAIL_MODE", "console");
  const from = env("EMAIL_FROM", "NudoEscudo <no-reply@localhost>");

  if (mode === "resend") {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("EMAIL_MODE=resend but RESEND_API_KEY is not set");
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html }),
    });
    if (!res.ok) {
      throw new Error(`Resend API error ${res.status}: ${await res.text()}`);
    }
    return;
  }

  if (mode === "smtp") {
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: env("SMTP_HOST", "localhost"),
      port: Number(env("SMTP_PORT", "1025")),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await transport.sendMail({ from, to: mail.to, subject: mail.subject, html: mail.html });
    return;
  }

  console.log(`[mail:console] to=${mail.to} subject="${mail.subject}"\n${mail.html}`);
}
