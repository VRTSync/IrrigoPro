import sgMail from '@sendgrid/mail';
import { storage } from './storage';
import { formatEstimateNumber } from '@workspace/shared';
import { DEFAULT_FROM_EMAIL, SENDGRID_FROM_NAME, senderFromCompany, type CompanySender } from './lib/company-sender';
import { emailBaseUrl } from './lib/email-base-url';
import { buildEstimateApprovalEmail, buildApprovalConfirmationEmail } from './outgoing-email/estimate-email';
import { escapeHtml } from './outgoing-email/layout';
import { logger } from './lib/logger';
import type { Company, Estimate } from '@workspace/db';

export { escapeHtml };

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
} else {
  console.warn(
    'SENDGRID_API_KEY not configured — transactional emails will not be sent.',
  );
}

function isEmailConfigured(): boolean {
  return Boolean(SENDGRID_API_KEY);
}

export interface EstimateEmailData {
  sender: CompanySender;
  estimateId: number;
  estimateNumber: string;
  customerName: string;
  customerLabel: string;
  customerEmail: string;
  projectName: string;
  projectAddress?: string;
  // Task #2010 — branch location for a multi-branch customer; omitted
  // from both bodies when the estimate has none.
  branchName?: string | null;
  workLocationLat?: string | null;
  workLocationLng?: string | null;
  workLocationAddress?: string | null;
  controllerLetter?: string | null;
  zoneNumber?: number | null;
  totalAmount: string;
  // Numeric subtotals for the breakdown block (Parts → Labor → Total).
  partsSubtotal?: number;
  laborSubtotal?: number;
  totalLaborHours?: number;
  laborRate?: number;
  // When true the email renders zone-grouped (inspection-origin estimate).
  isInspectionOrigin?: boolean;
  approvalToken: string;
  deliveryAttemptId?: string;
  estimateDate: string;
  companyId: number;
  companyProfile?: Company | null;
  subject?: string;
  workDescription?: string | null;
  items?: Array<{
    description: string;
    partName: string;
    quantity: number;
    partPrice: number;
    laborHours: number;
    partsCost: number;
    laborCost: number;
    lineTotal: number;
    // Zone fields present for inspection-origin estimates.
    controllerLetter?: string | null;
    zoneNumber?: number | null;
    issueType?: string | null;
  }>;
  // Task #616 — optional recipient overrides + manager note. When `to`
  // is omitted the email goes to `customerEmail` on file. `cc`/`bcc`
  // are forwarded straight to SendGrid. `note` renders above the
  // estimate summary in both HTML and text bodies (HTML-escaped).
  to?: string;
  cc?: string[];
  bcc?: string[];
  note?: string;
  attachmentFilename?: string;
  // Task #1791 — optional PDF attachment (base64-encoded PDF buffer).
  // When present, the attachment is forwarded to SendGrid as a file
  // attachment so the customer receives the estimate as a PDF document.
  attachments?: Array<{
    content: string;
    filename: string;
    type: string;
    disposition: 'attachment';
  }>;
}

// Only this error permits releasing a delivery claim and trying again.
export class EstimateEmailNotSubmittedError extends Error {}

interface ReportDelivery {
  sender: CompanySender;
  to: string;
  cc?: string[];
  bcc?: string[];
  pdfBuffer: Buffer;
  reviewed: { subject: string; html: string; text: string; filename: string };
}

export class EmailService {
  private static get baseUrl() {
    return emailBaseUrl();
  }

  static async sendEstimateApprovalEmail(data: EstimateEmailData): Promise<void> {
    // Task #703 — make a missing API key a hard failure on the
    // estimate path so it never records a successful delivery
    // and the frontend surfaces a real error instead of a
    // misleading "Sent." toast.
    if (!isEmailConfigured()) {
      throw new EstimateEmailNotSubmittedError(
        'Email is not configured: SENDGRID_API_KEY is missing. Estimate was not sent.',
      );
    }

    const approveUrl = `${this.baseUrl}/estimate-approval/${data.approvalToken}`;
    // Task #1574 — reject link goes to the React portal with ?intent=reject so
    // email security scanners (MS Safe Links, Google) only fetch a React page,
    // not the API endpoint that previously committed the rejection immediately.
    const rejectUrl = `${this.baseUrl}/estimate-approval/${data.approvalToken}?intent=reject`;
    const viewUrl = `${this.baseUrl}/estimate-approval/${data.approvalToken}`;

    const { subject, html, text } = await buildEstimateApprovalEmail(data, { approveUrl, rejectUrl, viewUrl })
      .catch((error: unknown) => {
        throw new EstimateEmailNotSubmittedError("Could not prepare the estimate email. Nothing was sent.", { cause: error });
      });

    const toAddr = (data.to && data.to.trim()) || data.customerEmail;
    const ccList = (data.cc ?? []).filter((s) => s && s.trim().length > 0);
    const bccList = (data.bcc ?? []).filter((s) => s && s.trim().length > 0);

    try {
      const [response] = await sgMail.send({
        from: data.sender.from,
        ...(data.sender.replyTo ? { replyTo: data.sender.replyTo } : {}),
        to: toAddr,
        ...(ccList.length ? { cc: ccList } : {}),
        ...(bccList.length ? { bcc: bccList } : {}),
        subject,
        html,
        text,
        categories: ['estimate-approval'],
        customArgs: {
          estimateId: data.estimateId.toString(),
          estimateNumber: data.estimateNumber,
          companyId: data.companyId.toString(),
          ...(data.deliveryAttemptId ? { deliveryAttemptId: data.deliveryAttemptId } : {}),
        },
        // Task #1791 — forward PDF attachment when the caller provides one.
        ...(data.attachments && data.attachments.length > 0
          ? { attachments: data.attachments }
          : {}),
      });

      if (response.statusCode !== 202) {
        throw new Error(`Unexpected SendGrid acceptance response: ${response.statusCode}`);
      }
    } catch (error) {
      // The SendGrid SDK puts the HTTP status in `code` on ResponseError.
      // Only explicit rejection responses are retryable; a timeout, dropped
      // connection, or 5xx can happen after the provider accepted the mail.
      const responseError = error as { code?: unknown; response?: { body?: { errors?: unknown } } } | null;
      const status = responseError?.code;
      if (responseError?.response && typeof status === 'number' &&
          [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(status)) {
        const errors = responseError.response.body?.errors;
        const reason = Array.isArray(errors)
          ? errors.map(e => e?.message).filter((m: unknown) => typeof m === 'string' && m.length > 0).join('; ')
          : '';
        throw new EstimateEmailNotSubmittedError(
          reason ? `SendGrid rejected the estimate email: ${reason}` : `SendGrid rejected the estimate email (HTTP ${status}).`,
          { cause: error },
        );
      }
      throw error;
    }
    logger.info({ estimateId: data.estimateId, companyId: data.companyId, attemptId: data.deliveryAttemptId }, 'SendGrid accepted estimate email');
  }

  private static escapeHtml = escapeHtml;

  static async sendMarketingLeadNotification(data: {
    companyName: string;
    contactName: string;
    email: string;
    phone?: string | null;
    numTechnicians?: number | null;
    message?: string | null;
  }): Promise<void> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured — marketing lead email skipped');
      return;
    }
    const toAddr =
      process.env.MARKETING_LEAD_TO_EMAIL ||
      process.env.LEADS_NOTIFY_EMAIL ||
      process.env.FROM_EMAIL;
    const fromAddr =
      process.env.MARKETING_LEAD_FROM_EMAIL ||
      DEFAULT_FROM_EMAIL;
    if (!toAddr) {
      console.error(
        'No recipient address for marketing lead email (set MARKETING_LEAD_TO_EMAIL, LEADS_NOTIFY_EMAIL, or FROM_EMAIL)',
      );
      return;
    }

    const lines = [
      `Company:      ${data.companyName}`,
      `Contact:      ${data.contactName}`,
      `Email:        ${data.email}`,
      `Phone:        ${data.phone || '(not provided)'}`,
      `Technicians:  ${data.numTechnicians ?? '(not provided)'}`,
      ``,
      `Message:`,
      data.message || '(none)',
    ];
    const esc = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined || v === '') return '(not provided)';
      return String(v).replace(/[&<>"']/g, (c) =>
        c === '&' ? '&amp;' :
        c === '<' ? '&lt;' :
        c === '>' ? '&gt;' :
        c === '"' ? '&quot;' : '&#39;',
      );
    };
    const escEmail = encodeURIComponent(data.email);
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1E5A99, #7DBE3F); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">New IrrigoPro demo request</h1>
          <p style="margin: 6px 0 0 0; opacity: 0.9;">From the marketing site</p>
        </div>
        <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr><td style="padding: 6px 0; font-weight: 600; color: #6b7280; width: 130px;">Company</td><td style="padding: 6px 0;">${esc(data.companyName)}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600; color: #6b7280;">Contact</td><td style="padding: 6px 0;">${esc(data.contactName)}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600; color: #6b7280;">Email</td><td style="padding: 6px 0;"><a href="mailto:${escEmail}" style="color:#1E5A99;">${esc(data.email)}</a></td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600; color: #6b7280;">Phone</td><td style="padding: 6px 0;">${esc(data.phone)}</td></tr>
            <tr><td style="padding: 6px 0; font-weight: 600; color: #6b7280;">Technicians</td><td style="padding: 6px 0;">${esc(data.numTechnicians)}</td></tr>
          </table>
          <h3 style="margin-top: 20px; color: #1f2937;">Message</h3>
          <div style="white-space: pre-wrap; background: #f9fafb; border-radius: 8px; padding: 12px; color: #374151; font-size: 14px;">${data.message ? esc(data.message) : '(none)'}</div>
        </div>
      </div>`;

    try {
      await sgMail.send({
        from: fromAddr,
        to: toAddr,
        replyTo: data.email,
        subject: `New IrrigoPro demo request — ${data.companyName}`,
        html: htmlBody,
        text: lines.join('\n'),
        categories: ['marketing-lead'],
      });
      console.log(`Marketing lead notification sent to ${toAddr}`);
    } catch (error) {
      console.error('Failed to send marketing lead notification:', error);
    }
  }

  static async sendApprovalConfirmation(args: { to: string; estimate: Estimate; approved: boolean; decidedAt: Date }): Promise<void> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured');
      return;
    }

    const { to, estimate } = args;
    try {
      const company = await storage.getCompanyProfile(estimate.companyId);
      const customer = estimate.customerId == null ? undefined : await storage.getCustomer(estimate.customerId);
      const customerName = customer?.companyId === estimate.companyId
        ? customer.irrigoName ?? customer.name
        : estimate.customerName;
      const sender = senderFromCompany(company);
      const content = await buildApprovalConfirmationEmail({
        company, companyId: estimate.companyId, customerName, estimateNumber: estimate.estimateNumber,
        projectName: estimate.projectName, approved: args.approved, decidedAt: args.decidedAt,
        totalAmount: estimate.totalAmount,
      });
      await sgMail.send({
        from: sender.from,
        ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
        to,
        ...content,
        categories: ['estimate-confirmation'],
      });

      console.log(`Approval confirmation sent to ${to}`);
    } catch (error) {
      console.error('Failed to send approval confirmation:', error);
      throw error;
    }
  }

  // Email verification functionality
  static async sendEmailVerification(email: string, verificationToken: string, userName: string): Promise<void> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured');
      return;
    }

    const verifyUrl = `${this.baseUrl}/api/auth/verify-email/${verificationToken}`;

    try {
      await sgMail.send({
        from: DEFAULT_FROM_EMAIL,
        to: email,
        subject: 'Verify Your IrrigoPro Account',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Account</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #1E5A99, #0E3B6B); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 28px;">Welcome to IrrigoPro</h1>
              <p style="margin: 8px 0 0 0; font-size: 18px; opacity: 0.9;">Verify Your Account</p>
            </div>
            
            <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
              <h2 style="color: #1f2937; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="font-size: 16px; color: #4b5563;">
                Thank you for creating your IrrigoPro account! To complete your registration and ensure account security, please verify your email address by clicking the button below.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verifyUrl}" style="display: inline-block; background: #10b981; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 18px;">
                  Verify Email Address
                </a>
              </div>

              <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; color: #6b7280; font-size: 14px;">
                  <strong>Security Notice:</strong> This verification link will expire in 24 hours for your security. If you didn't create this account, please ignore this email.
                </p>
              </div>

              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="color: #1E5A99; font-size: 12px; word-break: break-all; margin: 8px 0;">
                  ${verifyUrl}
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Welcome to IrrigoPro - Verify Your Account

Hello ${userName},

Thank you for creating your IrrigoPro account! To complete your registration and ensure account security, please verify your email address.

Click this link to verify: ${verifyUrl}

This verification link will expire in 24 hours for your security.

If you didn't create this account, please ignore this email.

Best regards,
The IrrigoPro Team
        `,
        categories: ['email-verification'],
      });

      console.log(`Email verification sent to ${email}`);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw error;
    }
  }

  // Password reset functionality
  static async sendPasswordReset(email: string, resetToken: string, userName: string): Promise<void> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured');
      return;
    }

    const resetUrl = `${this.baseUrl}/reset-password?token=${resetToken}`;

    try {
      await sgMail.send({
        from: DEFAULT_FROM_EMAIL,
        to: email,
        subject: 'Reset Your IrrigoPro Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Reset Your Password</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #ef4444, #dc2626); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 28px;">Password Reset</h1>
              <p style="margin: 8px 0 0 0; font-size: 18px; opacity: 0.9;">IrrigoPro Account Security</p>
            </div>
            
            <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
              <h2 style="color: #1f2937; margin-top: 0;">Hello ${userName},</h2>
              
              <p style="font-size: 16px; color: #4b5563;">
                We received a request to reset your IrrigoPro account password. If you made this request, click the button below to set a new password.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${resetUrl}" style="display: inline-block; background: #ef4444; color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 18px;">
                  Reset Password
                </a>
              </div>

              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; color: #7f1d1d; font-size: 14px;">
                  <strong>Security Notice:</strong> This reset link will expire in 1 hour. If you didn't request this password reset, please ignore this email - your password will remain unchanged.
                </p>
              </div>

              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; text-align: center;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  If the button doesn't work, copy and paste this link into your browser:
                </p>
                <p style="color: #1E5A99; font-size: 12px; word-break: break-all; margin: 8px 0;">
                  ${resetUrl}
                </p>
                <p style="color: #6b7280; font-size: 12px; margin-top: 16px;">
                  For security reasons, we recommend using a strong, unique password.
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        text: `
Reset Your IrrigoPro Password

Hello ${userName},

We received a request to reset your IrrigoPro account password. If you made this request, use the link below to set a new password:

${resetUrl}

This reset link will expire in 1 hour for your security.

If you didn't request this password reset, please ignore this email - your password will remain unchanged.

For security reasons, we recommend using a strong, unique password.

Best regards,
The IrrigoPro Team
        `,
        categories: ['password-reset'],
      });

      console.log(`Password reset email sent to ${email}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw error;
    }
  }

  static async sendMissingPhotosTechnicianEmail(args: {
    to: string;
    technicianName: string;
    sheets: Array<{
      id: number;
      billingNumber: string;
      customerName: string;
      branchName?: string | null;
      propertyAddress?: string | null;
      workDate?: Date | string | null;
    }>;
    companyName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured');
      return { success: false, error: 'Email service not configured' };
    }

    const baseUrl = this.baseUrl;
    const companyName = args.companyName || 'IrrigoPro';
    const fmtDate = (d?: Date | string | null) =>
      d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    const rowsHtml = args.sheets.map(s => {
      const url = `${baseUrl}/billing-sheets?openSheet=${s.id}`;
      const where = [s.customerName, s.branchName, s.propertyAddress].filter(Boolean).join(' — ');
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
            <div style="font-weight:600;color:#111827;">${s.billingNumber}</div>
            <div style="color:#6b7280;font-size:13px;">${where}</div>
            ${s.workDate ? `<div style="color:#6b7280;font-size:12px;">Worked ${fmtDate(s.workDate)}</div>` : ''}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;text-align:right;">
            <a href="${url}" style="display:inline-block;background:#1E5A99;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600;font-size:14px;">Add Photos</a>
          </td>
        </tr>`;
    }).join('');

    const rowsText = args.sheets.map(s => {
      const url = `${baseUrl}/billing-sheets?openSheet=${s.id}`;
      const where = [s.customerName, s.branchName, s.propertyAddress].filter(Boolean).join(' — ');
      return `- ${s.billingNumber} (${where})${s.workDate ? ` worked ${fmtDate(s.workDate)}` : ''}\n  ${url}`;
    }).join('\n');

    const subject = `Action needed: re-attach photos to ${args.sheets.length} of your billing sheet${args.sheets.length === 1 ? '' : 's'}`;

    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;max-width:640px;margin:0 auto;padding:20px;">
  <div style="background:#f59e0b;color:#fff;padding:20px;border-radius:10px 10px 0 0;">
    <h1 style="margin:0;font-size:22px;">Photos missing on your billing sheets</h1>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
    <p>Hi ${args.technicianName},</p>
    <p>Due to a bug that has now been fixed, the photos you uploaded while creating the following billing sheet${args.sheets.length === 1 ? '' : 's'} were not saved. If those photos are still on your phone, please tap <strong>Add Photos</strong> on each sheet to re-attach them.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">${rowsHtml}</table>
    <p style="color:#6b7280;font-size:13px;">Thanks for taking a moment to fix these — once the photos are back on the sheet you can ignore that sheet on the list.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px;">— ${companyName}</p>
  </div>
</body></html>`;

    const text = `Hi ${args.technicianName},

Due to a bug that has now been fixed, the photos you uploaded while creating the following billing sheet${args.sheets.length === 1 ? '' : 's'} were not saved. If those photos are still on your phone, please open each sheet and tap "Add Photos" to re-attach them.

${rowsText}

Thanks,
${companyName}
`;

    try {
      await sgMail.send({
        from: DEFAULT_FROM_EMAIL,
        to: args.to,
        subject,
        html,
        text,
        categories: ['missing-photos-tech'],
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to send missing-photos technician email:', error);
      const message = error instanceof Error ? error.message : 'Send failed';
      return { success: false, error: message };
    }
  }

  /**
   * Task #1887 — caller-supplied wording for {@link sendInvoiceDetailPdf}.
   *
    * The invoice mailer is one code path: base64 the supplied PDF bytes,
    * attach them, send. What it *says* is now the caller's
   * business, so a payment reminder can go out with its own subject, body and
   * company branding without a second invoice mailer existing to drift.
   *
   * Callers supply the exact wording and sender; the filename and categories
   * have transport defaults.
   */
  static async sendInvoiceDetailPdf(
    customerEmail: string,
    _customerName: string,
    invoiceNumber: string,
    pdfBuffer: Buffer,
    options: {
      sender: CompanySender;
      subject: string;
      html: string;
      text: string;
      cc?: string[];
      bcc?: string[];
      /** Attachment filename. Defaults to `Invoice_<number>_Detail.pdf`. */
      filename?: string;
      extraAttachments?: { filename: string; content: Buffer }[];
      /** SendGrid categories, for per-send reporting. */
      categories?: string[];
    },
  ): Promise<{ success: boolean; error?: string }> {
    if (!isEmailConfigured()) {
      console.error('SENDGRID_API_KEY not configured');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      const pdfBase64 = pdfBuffer.toString('base64');

      // Send email with PDF attachment
      await sgMail.send({
        from: options.sender.from,
        ...(options.sender.replyTo ? { replyTo: options.sender.replyTo } : {}),
        to: customerEmail,
        ...(options.cc?.length ? { cc: options.cc } : {}),
        ...(options.bcc?.length ? { bcc: options.bcc } : {}),
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: [
          {
            filename: options.filename ?? `Invoice_${invoiceNumber}_Detail.pdf`,
            content: pdfBase64,
            type: 'application/pdf',
            disposition: 'attachment',
          },
          ...(options.extraAttachments ?? []).map(({ filename, content }) => ({
            filename, content: content.toString('base64'), type: 'application/pdf', disposition: 'attachment',
          })),
        ],
        categories: options.categories ?? ['invoice-detail-pdf'],
      });

      console.log(`Invoice detail PDF sent to ${customerEmail} for invoice ${invoiceNumber}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to send invoice detail PDF:', error);
      const errors = (error as { response?: { body?: { errors?: unknown } } })?.response?.body?.errors;
      const reason = Array.isArray(errors)
        ? errors.map((entry) => entry?.message).filter((message): message is string => typeof message === "string" && !!message).join("; ")
        : "";
      return { success: false, error: reason || (error instanceof Error ? error.message : "Unknown error") };
    }
  }

  // Task #743 — notify company admins and billing managers when
  // QuickBooks flips to reconnect_required. Throws on configuration /
  // send failure so the caller's per-recipient try/catch can skip
  // without rolling back the status update.
  static async sendQuickBooksReconnectRequiredEmail(args: {
    to: string;
    companyName: string;
    reason: string;
    dashboardUrl: string;
    runbookUrl: string;
  }): Promise<void> {
    if (!isEmailConfigured()) {
      throw new Error('Email service not configured (SENDGRID_API_KEY missing)');
    }
    const subject = `Action required: QuickBooks reconnection needed for ${args.companyName}`;
    const html = `
<p>Hello,</p>
<p>The QuickBooks integration for <strong>${args.companyName}</strong> requires reconnection.</p>
<p><strong>Reason:</strong> ${args.reason || 'Token refresh failed or token has expired.'}</p>
<p>Please reconnect QuickBooks to restore invoice syncing:</p>
<p><a href="${args.dashboardUrl}">Go to QuickBooks Settings</a></p>
<p>If you need help, refer to the <a href="${args.runbookUrl}">QuickBooks integration runbook</a>.</p>
<p>This email was sent because your account has the company admin or billing manager role. You will receive at most one notification per 24 hours.</p>
`.trim();
    const text = `Action required: QuickBooks reconnection needed for ${args.companyName}\n\nReason: ${args.reason || 'Token refresh failed or token has expired.'}\n\nReconnect here: ${args.dashboardUrl}\n\nRunbook: ${args.runbookUrl}`;
    await sgMail.send({
      from: DEFAULT_FROM_EMAIL,
      to: args.to,
      subject,
      html,
      text,
      categories: ['qb-reconnect-required'],
    });
  }

  // Task #693 — Financial Pulse Slice 4. Generic budget-alert email
  // hook used by services/budget-alert-service.ts. The dispatcher
  // pre-renders the HTML/text payload (template lives next to the
  // service); this method just forwards to SendGrid. Throws on
  // configuration / send failure so the service can record a per-
  // recipient error in its own try/catch.
  static async sendBudgetAlertEmail(args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    tag?: string;
  }): Promise<void> {
    if (!isEmailConfigured()) {
      throw new Error('Email service not configured (SENDGRID_API_KEY missing)');
    }
    await sgMail.send({
      from: DEFAULT_FROM_EMAIL,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      categories: [args.tag || 'budget-alert'],
    });
  }

  // Send the signed estimate PDF to each company admin after a customer approval.
  // Called fire-and-forget from the approve-via-token handler; errors are logged
  // but never propagate to the caller so the approval response is unaffected.
  static async sendSignedEstimateCopyToAdmins(args: {
    adminEmails: string[];
    estimateNumber: string;
    customerName: string;
    signerName: string;
    pdfBuffer: Buffer;
    companyName: string;
  }): Promise<void> {
    if (!isEmailConfigured()) {
      console.warn('sendSignedEstimateCopyToAdmins: SENDGRID_API_KEY not set — skipping');
      return;
    }
    if (args.adminEmails.length === 0) return;

    const fmtNum = formatEstimateNumber(args.estimateNumber);
    const subject = `Signed Estimate ${fmtNum} — ${args.customerName}`;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#15803d,#166534);color:white;padding:24px 30px;border-radius:10px 10px 0 0;">
    <h1 style="margin:0;font-size:22px;">Estimate Approved &amp; Signed</h1>
    <p style="margin:6px 0 0;font-size:15px;opacity:.9;">${args.companyName}</p>
  </div>
  <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px;">
    <p style="font-size:16px;color:#1f2937;">
      <strong>${args.customerName}</strong> has approved and signed estimate <strong>${fmtNum}</strong>.
    </p>
    <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:16px 20px;margin:20px 0;">
      <table style="border-collapse:collapse;width:100%;">
        <tr>
          <td style="padding:4px 0;font-weight:600;color:#6b7280;width:120px;">Estimate</td>
          <td style="padding:4px 0;color:#111827;">${fmtNum}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-weight:600;color:#6b7280;">Customer</td>
          <td style="padding:4px 0;color:#111827;">${args.customerName}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;font-weight:600;color:#6b7280;">Signed by</td>
          <td style="padding:4px 0;color:#111827;">${args.signerName}</td>
        </tr>
      </table>
    </div>
    <p style="color:#4b5563;font-size:14px;">The signed PDF is attached to this email for your records.</p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px;">— ${args.companyName}</p>
  </div>
</body>
</html>`;

    const text = `Estimate Approved & Signed — ${fmtNum}

${args.customerName} has approved and signed estimate ${fmtNum}.
Signed by: ${args.signerName}

The signed PDF is attached to this email for your records.

— ${args.companyName}`;

    const safeCustomer = args.customerName
      // eslint-disable-next-line no-control-regex
      .replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const filename = safeCustomer
      ? `${safeCustomer} - ${fmtNum} (Signed).pdf`
      : `estimate-${fmtNum}-signed.pdf`;

    for (const adminEmail of args.adminEmails) {
      try {
        await sgMail.send({
          from: DEFAULT_FROM_EMAIL,
          to: adminEmail,
          subject,
          html,
          text,
          categories: ['estimate-signed-copy'],
          attachments: [
            {
              content: args.pdfBuffer.toString('base64'),
              filename,
              type: 'application/pdf',
              disposition: 'attachment',
            },
          ],
        });
      } catch (err) {
        console.error(`sendSignedEstimateCopyToAdmins: failed to email ${adminEmail}:`, err);
      }
    }
  }

  /**
   * Task #1544 — notifies company admins / managers that a customer clicked
   * "Request a new link" on an expired estimate approval page. Never sends a
   * link to the customer directly; the team re-sends via the Resend flow.
   */
  static async sendNewLinkRequestToAdmins(args: {
    adminEmails: string[];
    estimateNumber: string;
    customerName: string;
    customerEmail: string;
  }): Promise<void> {
    if (!isEmailConfigured()) {
      console.warn('sendNewLinkRequestToAdmins: SENDGRID_API_KEY not set — skipping');
      return;
    }
    const fmtNumber = formatEstimateNumber(args.estimateNumber);
    const subject = `[Action needed] ${args.customerName} requested a new approval link — Estimate ${fmtNumber}`;
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:linear-gradient(135deg,#1E5A99,#0E3B6B);color:white;padding:24px 30px;border-radius:12px 12px 0 0;">
    <h1 style="margin:0;font-size:22px;">New Approval Link Requested</h1>
  </div>
  <div style="background:white;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
    <p style="font-size:15px;color:#374151;margin-top:0;">
      <strong>${this.escapeHtml(args.customerName)}</strong>
      (${this.escapeHtml(args.customerEmail)}) clicked "Request a new link" on the
      approval page for Estimate <strong>${this.escapeHtml(fmtNumber)}</strong>.
      Their previous link has expired.
    </p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;margin:20px 0;">
      <p style="margin:0;color:#1e40af;font-size:14px;">
        <strong>Next step:</strong> Open the estimate in IrrigoPro and use the
        <em>Resend Approval Email</em> action to send them a fresh link to the email
        address on file. Do not reply to this notification with a link.
      </p>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px;">
      <tr><td style="padding:6px 0;font-weight:600;color:#6b7280;">Estimate:</td><td style="padding:6px 0;color:#1f2937;">${this.escapeHtml(fmtNumber)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;color:#6b7280;">Customer:</td><td style="padding:6px 0;color:#1f2937;">${this.escapeHtml(args.customerName)}</td></tr>
      <tr><td style="padding:6px 0;font-weight:600;color:#6b7280;">Email on file:</td><td style="padding:6px 0;color:#1f2937;">${this.escapeHtml(args.customerEmail)}</td></tr>
    </table>
  </div>
</body>
</html>`;
    const text = `New Approval Link Requested\n\n${args.customerName} (${args.customerEmail}) requested a new approval link for Estimate ${fmtNumber}.\n\nNext step: open the estimate in IrrigoPro and use the Resend Approval Email action to send them a fresh link to the email address on file.\n`;

    for (const adminEmail of args.adminEmails) {
      try {
        await sgMail.send({
          from: { email: DEFAULT_FROM_EMAIL, name: SENDGRID_FROM_NAME },
          to: adminEmail,
          subject,
          html,
          text,
          categories: ['estimate-new-link-request'],
          customArgs: { estimateNumber: args.estimateNumber },
        });
      } catch (err: any) {
        console.error(`sendNewLinkRequestToAdmins: failed to email ${adminEmail}:`, err?.response?.body ?? err);
      }
    }
  }

  /**
   * Emails the customer-facing wet check condition report as a PDF attachment.
   */
  static async sendWetCheckReport(args: ReportDelivery & { wetCheckId: number }): Promise<void> {
    if (!isEmailConfigured()) {
      throw new Error('Email is not configured: SENDGRID_API_KEY is missing. Report was not sent.');
    }

    const { subject, html, text, filename } = args.reviewed;

    try {
      await sgMail.send({
        from: args.sender.from,
        ...(args.sender.replyTo ? { replyTo: args.sender.replyTo } : {}),
        to: args.to,
        ...(args.cc?.length ? { cc: args.cc } : {}),
        ...(args.bcc?.length ? { bcc: args.bcc } : {}),
        subject,
        html,
        text,
        categories: ['wet-check-report'],
        customArgs: { wetCheckId: String(args.wetCheckId) },
        attachments: [
          {
            filename,
            content: args.pdfBuffer.toString('base64'),
            type: 'application/pdf',
            disposition: 'attachment',
          },
        ],
      });
    } catch (error: any) {
      const sgErrors = error?.response?.body?.errors;
      const sgReason = Array.isArray(sgErrors)
        ? sgErrors.map((e: any) => e?.message).filter((m: unknown): m is string => typeof m === 'string' && m.length > 0).join('; ')
        : '';
      const baseMsg = (error instanceof Error && error.message) || 'Unknown SendGrid error';
      throw new Error(
        sgReason
          ? `SendGrid rejected the report email: ${sgReason}`
          : `Failed to send report email: ${baseMsg}`,
      );
    }
  }

  /**
   * Emails the customer-facing Irrigation System Profile as a PDF attachment.
   */
  static async sendIrrigationProfileReport(args: ReportDelivery & { customerId: number }): Promise<void> {
    if (!isEmailConfigured()) {
      throw new Error(
        'Email is not configured: SENDGRID_API_KEY is missing. Report was not sent.',
      );
    }

    const { subject, html, text, filename } = args.reviewed;

    try {
      await sgMail.send({
        from: args.sender.from,
        ...(args.sender.replyTo ? { replyTo: args.sender.replyTo } : {}),
        to: args.to,
        ...(args.cc?.length ? { cc: args.cc } : {}),
        ...(args.bcc?.length ? { bcc: args.bcc } : {}),
        subject,
        html,
        text,
        categories: ['irrigation-profile-report'],
        customArgs: { customerId: String(args.customerId) },
        attachments: [
          {
            filename,
            content: args.pdfBuffer.toString('base64'),
            type: 'application/pdf',
            disposition: 'attachment',
          },
        ],
      });
    } catch (error: any) {
      const sgErrors = error?.response?.body?.errors;
      const sgReason = Array.isArray(sgErrors)
        ? sgErrors
            .map((e: any) => e?.message)
            .filter((m: unknown): m is string => typeof m === 'string' && m.length > 0)
            .join('; ')
        : '';
      const baseMsg = (error instanceof Error && error.message) || 'Unknown SendGrid error';
      throw new Error(
        sgReason
          ? `SendGrid rejected the irrigation profile email: ${sgReason}`
          : `Failed to send irrigation profile email: ${baseMsg}`,
      );
    }
  }
}
