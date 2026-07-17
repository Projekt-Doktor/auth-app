import { Resend } from "resend";
import fs from "fs";
import path from "path";

let resendClient: Resend | null = null;

function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

function buildMagicLinkUrl(token: string): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

function loadTemplate(link: string): { html: string; text: string } {
  const templatePath = path.join(process.cwd(), "lib", "templates", "magic-link.html");
  let html = fs.readFileSync(templatePath, "utf8");
  html = html.replace(/\{\{MAGIC_LINK\}\}/g, link);

  const text = [
    "Sign in to your account",
    "",
    "Click the link below to sign in. This link expires in 15 minutes and can only be used once.",
    "",
    link,
    "",
    "If you did not request this, you can safely ignore this email.",
  ].join("\n");

  return { html, text };
}

export async function sendMagicLink(email: string, rawToken: string): Promise<void> {
  const link = buildMagicLinkUrl(rawToken);
  const { html, text } = loadTemplate(link);

  const from = process.env.EMAIL_FROM ?? "noreply@example.com";

  const { error } = await getResend().emails.send({
    from,
    to: email,
    subject: "Your sign-in link",
    html,
    text,
  });

  if (error) {
    throw new Error(`Failed to send magic link email: ${error.message}`);
  }
}
