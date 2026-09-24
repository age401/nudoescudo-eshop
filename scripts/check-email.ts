/**
 * Email setup check. Prints the effective email config, asks Resend whether
 * the EMAIL_FROM domain is verified (and which DNS records are still missing),
 * and optionally sends a real test message.
 *
 *   npm run mail:check                    # config + domain status only
 *   npm run mail:check -- you@example.com # ...and send a test email there
 *
 * In production: docker compose exec app npm run mail:check -- you@example.com
 */
import { env, loadEnv } from "../src/lib/env";

loadEnv();

type ResendRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  priority?: number;
};
type ResendDomain = { id: string; name: string; status: string; region?: string };

let problems = 0;
const ok = (msg: string) => console.log(`  OK    ${msg}`);
const bad = (msg: string) => {
  problems++;
  console.log(`  FALLA ${msg}`);
};
const info = (msg: string) => console.log(`        ${msg}`);

function senderDomain(from: string): string | null {
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
  const at = addr.lastIndexOf("@");
  return at > 0 ? addr.slice(at + 1).trim().toLowerCase() : null;
}

async function resend(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function checkDomain(domain: string) {
  const { res, body } = await resend("/domains");
  if (res.status === 401 && body?.name === "restricted_api_key") {
    info("La API key es de tipo 'Sending access': no puede leer dominios.");
    info("Verificá el dominio en https://resend.com/domains (o probá el envío abajo).");
    return;
  }
  if (!res.ok) {
    bad(`Resend respondió ${res.status}: ${JSON.stringify(body)}`);
    return;
  }
  ok("RESEND_API_KEY válida");

  const domains: ResendDomain[] = body.data ?? [];
  // Resend verifies exact names: a sender on mail.x.com needs mail.x.com added.
  const match = domains.find((d) => d.name === domain) ?? null;
  if (!match) {
    bad(`El dominio '${domain}' no está agregado en Resend.`);
    info(`Dominios en la cuenta: ${domains.map((d) => `${d.name} (${d.status})`).join(", ") || "ninguno"}`);
    info("Agregalo en https://resend.com/domains → Add domain, y cargá los registros DNS que indica.");
    return;
  }
  if (match.status === "verified") {
    ok(`Dominio '${domain}' verificado en Resend (región ${match.region ?? "?"})`);
    return;
  }
  bad(`Dominio '${domain}' en estado '${match.status}' (tiene que ser 'verified').`);

  const detail = await resend(`/domains/${match.id}`);
  const records: ResendRecord[] = detail.body?.records ?? [];
  if (records.length) {
    info("Registros DNS a cargar en el proveedor del dominio:");
    for (const r of records) {
      const prio = r.priority !== undefined ? ` (prioridad ${r.priority})` : "";
      info(`  [${r.status}] ${r.record} ${r.type} ${r.name} → ${r.value}${prio}`);
    }
  }
  info("Cuando estén cargados, en https://resend.com/domains tocá 'Verify DNS records'.");
  // Kick a re-check; harmless if DNS is not there yet.
  await resend(`/domains/${match.id}/verify`, { method: "POST" });
  info("Se pidió a Resend que vuelva a verificar; puede tardar unos minutos.");
}

async function main() {
  const to = process.argv[2];
  const mode = env("EMAIL_MODE", "console");
  const from = env("EMAIL_FROM", "NudoEscudo <no-reply@localhost>");
  const admin = env("ADMIN_EMAIL", "admin@localhost");
  const redirect = process.env.MAIL_REDIRECT_TO?.trim();

  console.log("Configuración de email");
  info(`EMAIL_MODE=${mode}`);
  info(`EMAIL_FROM=${from}`);
  info(`ADMIN_EMAIL=${admin}`);
  info(`SITE_URL=${env("SITE_URL", "(sin definir)")}`);

  if (mode === "resend") ok("EMAIL_MODE=resend");
  else bad(`EMAIL_MODE=${mode}: en producción tiene que ser 'resend'.`);

  if (redirect) bad(`MAIL_REDIRECT_TO=${redirect}: TODOS los emails van a esa dirección. Vaciarlo en producción.`);
  else ok("MAIL_REDIRECT_TO vacío");

  if (admin.endsWith("@localhost")) bad("ADMIN_EMAIL apunta a localhost: poné el email real del dueño.");
  else ok("ADMIN_EMAIL definido");

  const domain = senderDomain(from);
  if (!domain || domain === "localhost" || domain.endsWith(".local")) {
    bad(`EMAIL_FROM usa '${domain ?? from}': tiene que ser una dirección del dominio verificado en Resend.`);
  } else if (domain === "resend.dev") {
    bad("EMAIL_FROM usa resend.dev: solo entrega al email dueño de la cuenta Resend. Usá tu dominio.");
  } else {
    ok(`Dominio remitente: ${domain}`);
  }

  if (mode === "resend") {
    console.log("\nResend");
    if (!process.env.RESEND_API_KEY) bad("RESEND_API_KEY vacío.");
    else if (!process.env.RESEND_API_KEY.startsWith("re_")) bad("RESEND_API_KEY no parece una key de Resend (empieza con 're_').");
    else if (domain) await checkDomain(domain);
  }

  if (to) {
    console.log(`\nEnvío de prueba a ${to}`);
    const { sendMail } = await import("../src/lib/mailer");
    try {
      await sendMail({
        to,
        subject: `Prueba de email — ${env("STORE_NAME", "NudoEscudo")}`,
        html: `<p>Si leés esto, los emails de pedidos salen bien desde <b>${from.replace(/</g, "&lt;")}</b>.</p>`,
      });
      ok(`Enviado. Revisá la bandeja (y spam) de ${redirect || to}.`);
    } catch (err) {
      bad(`No se pudo enviar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(problems ? `\n${problems} problema(s) a resolver.` : "\nTodo OK.");
  process.exit(problems ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
