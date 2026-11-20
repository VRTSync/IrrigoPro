import type { Company } from "@workspace/db";
import { emailBaseUrl } from "../lib/email-base-url";
import { resolveCompanyLogoUrl } from "../logo-url";
import type { Wording } from "./wording";

export type Stripe = "green" | "amber" | "red" | "slate";
type Action = { label: string; href: string };
export interface EmailLayoutInput {
  company: Pick<Company, "name" | "logo" | "phone" | "email" | "website" | "address">;
  subject: string;
  docType: string;
  docNumber: string;
  stripe: Stripe;
  wording: Omit<Wording, "subject">;
  customerName: string;
  note: string;
  facts: { label: string; value: string }[];
  total?: { label: string; value: string };
  /** Trusted, pre-escaped estimate detail markup from the server. */
  detailHtml?: string;
  detailText?: string;
  actions?: { primary: Action; secondary?: Action; link?: Action };
  attachments: { title: string; filename: string }[];
}

const COLORS = {
  green: { stripe: "#82bf40", eyebrow: "#4a7419" },
  amber: { stripe: "#f0b429", eyebrow: "#8d5a00" },
  red: { stripe: "#d64545", eyebrow: "#a61b1b" },
  slate: { stripe: "#9fb3c8", eyebrow: "#486581" },
} satisfies Record<Stripe, { stripe: string; eyebrow: string }>;

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
const PARAGRAPH = "margin:0 0 16px;font-size:15px;line-height:1.6;color:#3e4c59;";
const FOOTER_LINK = "color:#b5d98a;text-decoration:underline;";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatPhone(raw: string | null | undefined): string {
  const typed = raw?.trim() ?? "";
  let digits = typed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : typed;
}

export function displayWebsite(raw: string | null | undefined): string {
  return raw?.trim().replace(/^[a-z][a-z\d+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "") ?? "";
}

function webHref(raw: string): string | null {
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

function actionHref({ href }: Action): string | null {
  // The review preview may show a placeholder instead of a live approval URL.
  return /^about:blank(?:#|$)/.test(href) ? href : webHref(href);
}

function renderAction(action: Action, primary: boolean): string {
  const href = actionHref(action);
  if (!href) return "";
  const background = primary ? "#82bf40" : "#ffffff";
  return `<table ${TABLE} style="margin:0 0 10px;"><tr><td bgcolor="${background}" style="border-radius:8px;${primary ? "" : "border:1px solid #bcccdc;"}mso-padding-alt:14px 28px;">
    <a href="${escapeHtml(href)}" style="display:block;padding:14px 28px;color:#102a43;font-size:15px;font-weight:bold;text-decoration:none;mso-padding-alt:0;">${escapeHtml(action.label)}</a>
  </td></tr></table>`;
}

export function renderEmailLayout(input: EmailLayoutInput): { html: string; text: string } {
  const { company, subject, docType, docNumber, stripe, wording, customerName, note, facts, total, actions, attachments } = input;
  const esc = escapeHtml;
  const baseUrl = emailBaseUrl();
  const logo = resolveCompanyLogoUrl(company.logo, baseUrl);
  const logoUrl = logo ? webHref(logo) : null;
  const logoCell = (size: number) => logoUrl
    ? `<td valign="middle" width="${size}" style="padding-right:12px;"><img src="${esc(logoUrl)}" alt="${esc(company.name)}" width="${size}" height="${size}" style="display:block;border:0;object-fit:contain;"></td>`
    : "";
  const address = company.address?.trim() ?? "";
  const phone = formatPhone(company.phone);
  const email = company.email?.trim() ?? "";
  const website = displayWebsite(company.website);
  const rawWebsite = company.website?.trim() ?? "";
  const websiteHref = website && webHref(/^[a-z][a-z\d+.-]*:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`);
  const addressLine = [address, phone].filter(Boolean).join(" · ");
  const contactLinks = [
    email && `<a href="mailto:${esc(email)}" style="${FOOTER_LINK}">${esc(email)}</a>`,
    websiteHref ? `<a href="${esc(websiteHref)}" style="${FOOTER_LINK}">${esc(website)}</a>` : esc(website),
  ].filter(Boolean).join(" · ");
  const hasNote = Boolean(note.trim());
  const colors = COLORS[stripe];
  const factRows = facts.map(({ label, value }, index) => {
    const border = index ? "border-top:1px solid #edf1f5;" : "";
    return `<tr><th scope="row" align="left" style="${border}padding:11px 14px;font-size:14px;font-weight:normal;color:#52606d;">${esc(label)}</th>
      <td align="right" style="${border}padding:11px 14px;font-size:14px;color:#102a43;">${esc(value)}</td></tr>`;
  }).join("");
  const totalRow = total ? `<tr bgcolor="#1e5c99">
    <th scope="row" align="left" style="padding:12px 14px;font-size:15px;font-weight:bold;color:#ffffff;">${esc(total.label)}</th>
    <td align="right" style="padding:12px 14px;font-size:22px;font-weight:bold;color:#ffffff;">${esc(total.value)}</td>
  </tr>` : "";
  const textActions = actions ? [actions.primary, actions.secondary, actions.link].flatMap(action => {
    const href = action && actionHref(action);
    return action && href ? [`${action.label}: ${href}`] : [];
  }) : [];
  const textLink = actions?.link && actionHref(actions.link);

  return {
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(subject)}</title>
</head>
<body bgcolor="#e9eef3" style="margin:0;padding:0;background-color:#e9eef3;font-family:${FONT};">
  <table ${TABLE} width="100%" bgcolor="#e9eef3">
    <tr><td align="center" style="padding:16px 0;">
      <!--[if mso]><table ${TABLE} width="600"><tr><td><![endif]-->
      <table ${TABLE} width="600" bgcolor="#ffffff" style="width:100%;max-width:600px;border-radius:14px;overflow:hidden;font-family:${FONT};">
        <tr bgcolor="#1e5c99"><td style="padding:22px 32px;border-radius:14px 14px 0 0;">
          <table ${TABLE} width="100%"><tr>
            ${logoCell(64)}
            <td valign="middle" style="font-size:15px;font-weight:bold;color:#ffffff;">${esc(company.name)}</td>
            <td align="right" valign="middle" style="padding-left:12px;color:#ffffff;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;">${esc(docType)}</div>
              <div style="font-size:18px;font-weight:bold;">${esc(docNumber)}</div>
            </td>
          </tr></table>
        </td></tr>
        <tr bgcolor="${colors.stripe}"><td height="5" style="height:5px;font-size:1px;line-height:5px;">&nbsp;</td></tr>
        <tr><td style="padding:28px 32px 32px;overflow-wrap:break-word;">
          ${wording.eyebrow ? `<p style="margin:0 0 8px;font-size:12px;font-weight:bold;text-transform:uppercase;color:${colors.eyebrow};">${esc(wording.eyebrow)}</p>` : ""}
          ${wording.headline ? `<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#102a43;">${esc(wording.headline)}</h1>` : ""}
          <p style="${PARAGRAPH}">Hello ${esc(customerName)},</p>
          ${wording.intro ? `<p style="${PARAGRAPH}">${esc(wording.intro)}</p>` : ""}
          ${hasNote ? `<table ${TABLE} width="100%" bgcolor="#f1f7e8" style="margin:0 0 18px;border-radius:10px;"><tr><td style="padding:14px 16px;color:#3e4c59;">
            <p style="margin:0 0 5px;font-size:12px;font-weight:bold;color:#4a7419;">A note from ${esc(company.name)}</p>
            <p style="margin:0;font-size:14px;line-height:1.6;white-space:pre-wrap;">${esc(note)}</p>
          </td></tr></table>` : ""}
          ${factRows || totalRow ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;border:1px solid #dbe4ee;border-radius:10px;overflow:hidden;">${factRows}${totalRow}</table>` : ""}
          ${input.detailHtml ?? ""}
          ${actions ? `${renderAction(actions.primary, true)}${actions.secondary ? renderAction(actions.secondary, false) : ""}
            ${actions.link && textLink ? `<p style="${PARAGRAPH}"><a href="${esc(textLink)}" style="color:#1e5c99;font-weight:bold;">${esc(actions.link.label)}</a></p>` : ""}` : ""}
          ${attachments.map(({ title, filename }) => `<table ${TABLE} width="100%" bgcolor="#f5f8fb" style="margin:0 0 14px;border-radius:8px;"><tr><td style="padding:12px 14px;font-size:14px;line-height:1.5;">
            <strong style="color:#102a43;">${esc(title)}</strong><br><span style="color:#52606d;">${esc(filename)}</span>
          </td></tr></table>`).join("")}
          ${wording.closing ? `<p style="${PARAGRAPH}">${esc(wording.closing)}</p>` : ""}
          <p style="margin:0;font-size:15px;line-height:1.6;color:#3e4c59;">Thank you,<br><strong>${esc(company.name)}</strong></p>
        </td></tr>
        <tr bgcolor="#102a43"><td style="padding:20px 32px;color:#ffffff;">
          <table ${TABLE} width="100%"><tr>
            ${logoCell(44)}
            <td valign="middle" style="font-size:13px;line-height:1.5;color:#ffffff;overflow-wrap:break-word;">
              <strong>${esc(company.name)}</strong>${addressLine ? `<br>${esc(addressLine)}` : ""}${contactLinks ? `<br>${contactLinks}` : ""}
            </td>
          </tr></table>
        </td></tr>
        <tr bgcolor="#ffffff"><td align="center" style="padding:12px 16px;">
          <table ${TABLE} align="center"><tr>
            <td valign="middle" style="padding-right:7px;font-size:11px;color:#52606d;">Sent with</td>
            <td valign="middle"><img src="${esc(`${baseUrl}/email/irrigopro-wordmark.png`)}" height="20" alt="IrrigoPro" style="display:block;border:0;height:20px;"></td>
          </tr></table>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</body>
</html>`,
    text: [
      company.name, wording.headline, `Hello ${customerName},`, wording.intro,
      hasNote ? `A note from ${company.name}: ${note}` : "",
      [...facts, ...(total ? [total] : [])].map(({ label, value }) => `${label}: ${value}`).join("\n"),
      input.detailText, textActions.join("\n"),
      attachments.map(({ filename }) => `Attached: ${filename}`).join("\n"),
      wording.closing, `Thank you,\n${company.name}`,
      [addressLine, [email, website].filter(Boolean).join(" · ")].filter(Boolean).join("\n"),
    ].filter(Boolean).join("\n\n"),
  };
}
