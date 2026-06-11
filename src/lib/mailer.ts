/**
 * Email abstraction. EMAIL_MODE selects the driver:
 *  - 'smtp'    : any SMTP server (dev: Mailpit on localhost:1025)
 *  - 'resend'  : Resend HTTP API (production)
 *  - 'console' : log to stdout (tests / last resort)
 */
import { env, loadEnv } from "@/lib/env";

loadEnv();

export type Mail = { to: string; subject: string; html: string };

export async function sendMail(mail: Mail): Promise<void> {
  const mode = env("EMAIL_MODE", "console");
  const from = env("EMAIL_FROM", "NudoEscudo <no-reply@localhost>");

  if (mode === "resend") {
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
