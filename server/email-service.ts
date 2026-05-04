import { Client } from 'postmark';
import { ObjectStorageService } from './objectStorage';
import { storage } from './storage';

// Initialize Postmark client
const client = new Client(process.env.POSTMARK_API_TOKEN || '');

export interface EstimateEmailData {
  estimateId: number;
  estimateNumber: string;
  customerName: string;
  customerEmail: string;
  projectName: string;
  projectAddress?: string;
  totalAmount: string;
  approvalToken: string;
  estimateDate: string;
  createdBy: string;
  companyId: number;
  items?: Array<{
    description: string;
    partName: string;
    quantity: number;
    partPrice: number;
    laborHours: number;
    partsCost: number;
    laborCost: number;
    lineTotal: number;
  }>;
}

export class EmailService {
  private static get baseUrl() {
    // Use environment variable if set (flexible for different production domains)
    if (process.env.APP_BASE_URL) {
      return process.env.APP_BASE_URL.replace(/\/$/, ''); // Remove trailing slash
    }
    
    // Production fallback (maintains existing behavior)
    if (process.env.NODE_ENV === 'production') {
      return 'https://irrigopro.com';
    }
    
    // For development, use the current Replit domain from REPLIT_DOMAINS
    const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
    if (replitDomain) {
      return `https://${replitDomain}`;
    }
    
    // Fallback to standard Replit format
    return `https://${process.env.REPL_ID}.${process.env.REPL_OWNER}.replit.dev`;
  }

  static async sendEstimateApprovalEmail(data: EstimateEmailData): Promise<void> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return;
    }

    const approveUrl = `${this.baseUrl}/estimate-approval/${data.approvalToken}`;
    const rejectUrl = `${this.baseUrl}/api/estimates/reject-via-token/${data.approvalToken}`;
    const viewUrl = `${this.baseUrl}/api/estimates/view-via-token/${data.approvalToken}`;

    // Get company information including logo
    const company = await storage.getCompanyProfile(data.companyId);
    const companyInfo = {
      name: company?.name || 'IrrigoPro',
      logo: company?.logo ? this.getCompanyLogoUrl(company.logo) : null,
      email: company?.email || process.env.FROM_EMAIL || 'estimates@irrigopro.com',
      phone: company?.phone || '',
      website: company?.website || ''
    };

    const htmlContent = this.generateEstimateEmailHTML(data, approveUrl, rejectUrl, viewUrl, companyInfo);
    const textContent = this.generateEstimateEmailText(data, approveUrl, rejectUrl, companyInfo);

    try {
      await client.sendEmail({
        From: companyInfo.email,
        To: data.customerEmail,
        Subject: `Estimate Approval Required - ${data.estimateNumber}`,
        HtmlBody: htmlContent,
        TextBody: textContent,
        Tag: 'estimate-approval',
        Metadata: {
          estimateId: data.estimateId.toString(),
          estimateNumber: data.estimateNumber,
          companyId: data.companyId.toString()
        }
      });

      console.log(`Estimate approval email sent to ${data.customerEmail}`);
    } catch (error) {
      console.error('Failed to send estimate approval email:', error);
      throw error;
    }
  }

  private static getCompanyLogoUrl(logoPath: string): string {
    if (logoPath.startsWith('http')) {
      return logoPath; // Already a full URL
    }
    
    const baseUrl = this.baseUrl;

    // Relative path already pointing to the correct serving route
    if (logoPath.startsWith('/api/')) {
      return `${baseUrl}${logoPath}`;
    }

    // Bare logo ID — construct the correct serving route
    return `${baseUrl}/api/company-logo/${logoPath}`;
  }

  private static generateEstimateEmailHTML(
    data: EstimateEmailData, 
    approveUrl: string, 
    rejectUrl: string, 
    viewUrl: string,
    companyInfo: {
      name: string;
      logo: string | null;
      email: string;
      phone: string;
      website: string;
    }
  ): string {
    const itemsRowsHTML = data.items?.map(item => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; vertical-align: top; color: #1f2937;">${item.description || item.partName}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #1f2937; white-space: nowrap;">${item.quantity}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #1f2937; white-space: nowrap;">$${item.partPrice.toFixed(2)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #1f2937; white-space: nowrap;">${item.laborHours.toFixed(2)}h</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #1f2937; white-space: nowrap; font-weight: 600;">$${item.lineTotal.toFixed(2)}</td>
        </tr>
    `).join('') || '';

    const itemsHTML = itemsRowsHTML ? `
      <table role="presentation" style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; font-size: 14px;">
        <thead>
          <tr style="background: #f3f4f6;">
            <th style="padding: 10px 12px; text-align: left; color: #374151; font-weight: 600;">Description</th>
            <th style="padding: 10px 12px; text-align: right; color: #374151; font-weight: 600;">Qty</th>
            <th style="padding: 10px 12px; text-align: right; color: #374151; font-weight: 600;">Unit</th>
            <th style="padding: 10px 12px; text-align: right; color: #374151; font-weight: 600;">Labor</th>
            <th style="padding: 10px 12px; text-align: right; color: #374151; font-weight: 600;">Line Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRowsHTML}
        </tbody>
      </table>
    ` : '';

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Estimate Approval Required</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    ${companyInfo.logo ? `
    <div style="margin-bottom: 20px;">
      <img src="${companyInfo.logo}" alt="${companyInfo.name} Logo" style="max-height: 60px; max-width: 200px; object-fit: contain;">
    </div>
    ` : ''}
    <h1 style="margin: 0; font-size: 28px;">Irrigation Estimate</h1>
    <p style="margin: 8px 0 0 0; font-size: 18px; opacity: 0.9;">Your Approval Required</p>
  </div>
  
  <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
    <h2 style="color: #1f2937; margin-top: 0;">Hello ${data.customerName},</h2>
    
    <p style="font-size: 16px; color: #4b5563;">
      We've prepared an estimate for your irrigation project. Please review the details below and let us know if you'd like to proceed.
    </p>
    
    <div style="background: #f9fafb; border-radius: 8px; padding: 20px; margin: 20px 0;">
      <h3 style="margin: 0 0 16px 0; color: #374151;">Estimate Details</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Estimate #:</td>
          <td style="padding: 8px 0; color: #1f2937;">${data.estimateNumber}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Project:</td>
          <td style="padding: 8px 0; color: #1f2937;">${data.projectName}</td>
        </tr>
        ${data.projectAddress ? `
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Location:</td>
          <td style="padding: 8px 0; color: #1f2937;">${data.projectAddress}</td>
        </tr>
        ` : ''}
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Date:</td>
          <td style="padding: 8px 0; color: #1f2937;">${data.estimateDate}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600; color: #6b7280;">Prepared by:</td>
          <td style="padding: 8px 0; color: #1f2937;">${data.createdBy}</td>
        </tr>
      </table>
    </div>

    ${itemsHTML ? `
    <div style="margin: 20px 0;">
      <h3 style="color: #374151; margin-bottom: 16px;">Line Items</h3>
      ${itemsHTML}
    </div>
    ` : ''}

    <div style="background: #1f2937; color: white; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
      <h3 style="margin: 0; font-size: 24px;">Total Estimate</h3>
      <p style="margin: 8px 0 0 0; font-size: 32px; font-weight: bold;">${data.totalAmount}</p>
    </div>

    <div style="text-align: center; margin: 30px 0;">
      <p style="font-size: 18px; color: #374151; margin-bottom: 20px;">Ready to proceed?</p>
      
      <a href="${approveUrl}" style="display: inline-block; background: #10b981; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 0 10px 10px 10px;">
        ✓ Approve Estimate
      </a>
      
      <a href="${rejectUrl}" style="display: inline-block; background: #ef4444; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin: 0 10px 10px 10px;">
        ✗ Decline Estimate
      </a>
    </div>

    <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px; text-align: center;">
      <p style="color: #6b7280; font-size: 14px; margin: 0;">
        Need to review the full details? <a href="${viewUrl}" style="color: #3b82f6;">View Complete Estimate</a>
      </p>
      <div style="margin: 20px 0; color: #6b7280; font-size: 14px;">
        <p style="margin: 4px 0; font-weight: 600; color: #374151;">${companyInfo.name}</p>
        ${companyInfo.phone ? `<p style="margin: 4px 0;">📞 ${companyInfo.phone}</p>` : ''}
        ${companyInfo.email ? `<p style="margin: 4px 0;">✉️ ${companyInfo.email}</p>` : ''}
        ${companyInfo.website ? `<p style="margin: 4px 0;">🌐 <a href="${companyInfo.website}" style="color: #3b82f6;">${companyInfo.website}</a></p>` : ''}
      </div>
      <p style="color: #6b7280; font-size: 12px; margin: 8px 0 0 0;">
        Questions? Reply to this email or call us directly.
      </p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private static generateEstimateEmailText(
    data: EstimateEmailData, 
    approveUrl: string, 
    rejectUrl: string,
    companyInfo: {
      name: string;
      logo: string | null;
      email: string;
      phone: string;
      website: string;
    }
  ): string {
    const itemsText = data.items?.map(item =>
      `${item.description || item.partName}: ${item.quantity} × $${item.partPrice.toFixed(2)} + Labor ${item.laborHours.toFixed(2)}h ($${item.laborCost.toFixed(2)}) = $${item.lineTotal.toFixed(2)}`
    ).join('\n') || '';

    return `
IRRIGATION ESTIMATE - APPROVAL REQUIRED

Hello ${data.customerName},

We've prepared an estimate for your irrigation project. Please review the details below:

ESTIMATE DETAILS:
- Estimate #: ${data.estimateNumber}
- Project: ${data.projectName}
${data.projectAddress ? `- Location: ${data.projectAddress}` : ''}
- Date: ${data.estimateDate}
- Prepared by: ${data.createdBy}

${itemsText ? `
LINE ITEMS:
${itemsText}
` : ''}

TOTAL ESTIMATE: ${data.totalAmount}

ACTIONS:
- To approve this estimate, visit: ${approveUrl}
- To decline this estimate, visit: ${rejectUrl}

---
${companyInfo.name}
${companyInfo.phone ? `Phone: ${companyInfo.phone}` : ''}
${companyInfo.email ? `Email: ${companyInfo.email}` : ''}
${companyInfo.website ? `Website: ${companyInfo.website}` : ''}

Questions? Reply to this email or call us directly.
    `;
  }

  static async sendApprovalConfirmation(customerEmail: string, estimateNumber: string, approved: boolean): Promise<void> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return;
    }

    const action = approved ? 'approved' : 'declined';
    const nextSteps = approved 
      ? 'We will begin scheduling your irrigation work and will contact you soon with next steps.'
      : 'Thank you for your time. Please feel free to contact us if you have any questions or would like to discuss alternatives.';

    try {
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'estimates@irrigationcompany.com',
        To: customerEmail,
        Subject: `Estimate ${approved ? 'Approved' : 'Declined'} - ${estimateNumber}`,
        HtmlBody: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: ${approved ? '#10b981' : '#6b7280'};">
              Estimate ${approved ? 'Approved' : 'Declined'}
            </h2>
            <p>Thank you for your response regarding estimate ${estimateNumber}.</p>
            <p>We have recorded that you have <strong>${action}</strong> this estimate.</p>
            <p>${nextSteps}</p>
            <p>If you have any questions, please don't hesitate to contact us.</p>
            <p>Best regards,<br>Your Irrigation Team</p>
          </div>
        `,
        TextBody: `
Estimate ${approved ? 'Approved' : 'Declined'} - ${estimateNumber}

Thank you for your response regarding estimate ${estimateNumber}.

We have recorded that you have ${action} this estimate.

${nextSteps}

If you have any questions, please don't hesitate to contact us.

Best regards,
Your Irrigation Team
        `,
        Tag: 'estimate-confirmation'
      });

      console.log(`Approval confirmation sent to ${customerEmail}`);
    } catch (error) {
      console.error('Failed to send approval confirmation:', error);
      throw error;
    }
  }

  // Email verification functionality
  static async sendEmailVerification(email: string, verificationToken: string, userName: string): Promise<void> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return;
    }

    const verifyUrl = `${this.baseUrl}/api/auth/verify-email/${verificationToken}`;

    try {
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@irrigopro.com',
        To: email,
        Subject: 'Verify Your IrrigoPro Account',
        HtmlBody: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Verify Your Account</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
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
                <p style="color: #3b82f6; font-size: 12px; word-break: break-all; margin: 8px 0;">
                  ${verifyUrl}
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        TextBody: `
Welcome to IrrigoPro - Verify Your Account

Hello ${userName},

Thank you for creating your IrrigoPro account! To complete your registration and ensure account security, please verify your email address.

Click this link to verify: ${verifyUrl}

This verification link will expire in 24 hours for your security.

If you didn't create this account, please ignore this email.

Best regards,
The IrrigoPro Team
        `,
        Tag: 'email-verification'
      });

      console.log(`Email verification sent to ${email}`);
    } catch (error) {
      console.error('Failed to send verification email:', error);
      throw error;
    }
  }

  // Password reset functionality
  static async sendPasswordReset(email: string, resetToken: string, userName: string): Promise<void> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return;
    }

    const resetUrl = `${this.baseUrl}/reset-password?token=${resetToken}`;

    try {
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@irrigopro.com',
        To: email,
        Subject: 'Reset Your IrrigoPro Password',
        HtmlBody: `
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
                <p style="color: #3b82f6; font-size: 12px; word-break: break-all; margin: 8px 0;">
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
        TextBody: `
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
        Tag: 'password-reset'
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
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
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
            <a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600;font-size:14px;">Add Photos</a>
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
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'noreply@irrigopro.com',
        To: args.to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        Tag: 'missing-photos-tech',
      });
      return { success: true };
    } catch (error) {
      console.error('Failed to send missing-photos technician email:', error);
      const message = error instanceof Error ? error.message : 'Send failed';
      return { success: false, error: message };
    }
  }

  static async sendInvoiceDetailPdf(
    customerEmail: string,
    customerName: string,
    invoiceNumber: string,
    pdfUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return { success: false, error: 'Email service not configured' };
    }

    try {
      // Download PDF from object storage
      const objectStorageService = new ObjectStorageService();
      const file = await objectStorageService.searchPublicObject(pdfUrl);
      
      if (!file) {
        return { success: false, error: 'PDF file not found in storage' };
      }

      // Read file content as buffer
      const chunks: Buffer[] = [];
      const stream = file.createReadStream();
      
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      
      const pdfBuffer = Buffer.concat(chunks);
      const pdfBase64 = pdfBuffer.toString('base64');

      // Send email with PDF attachment
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'billing@irrigopro.com',
        To: customerEmail,
        Subject: `Invoice Detail Report - ${invoiceNumber}`,
        HtmlBody: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invoice Detail Report</title>
          </head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #3b82f6, #2563eb); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="margin: 0; font-size: 28px;">Invoice Detail Report</h1>
              <p style="margin: 8px 0 0 0; font-size: 18px; opacity: 0.9;">IrrigoPro</p>
            </div>
            
            <div style="background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; padding: 30px;">
              <h2 style="color: #1f2937; margin-top: 0;">Hello ${customerName},</h2>
              
              <p style="font-size: 16px; color: #4b5563;">
                Please find attached the detailed work order breakdown for invoice <strong>${invoiceNumber}</strong>.
              </p>
              
              <p style="font-size: 16px; color: #4b5563;">
                This report provides a complete itemization of all work performed, parts used, labor hours, and associated costs for the billing period.
              </p>

              <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0; color: #1e40af; font-size: 14px;">
                  <strong>📎 Attachment:</strong> The detailed PDF report is attached to this email.
                </p>
              </div>

              <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
                <p style="color: #6b7280; font-size: 14px; margin: 0;">
                  If you have any questions about this invoice or the attached detail report, please don't hesitate to contact us.
                </p>
                <p style="color: #6b7280; font-size: 14px; margin: 8px 0 0 0;">
                  Thank you for your business!
                </p>
              </div>

              <div style="text-align: center; margin-top: 30px;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  This is an automated email from IrrigoPro
                </p>
              </div>
            </div>
          </body>
          </html>
        `,
        TextBody: `
Invoice Detail Report - ${invoiceNumber}

Hello ${customerName},

Please find attached the detailed work order breakdown for invoice ${invoiceNumber}.

This report provides a complete itemization of all work performed, parts used, labor hours, and associated costs for the billing period.

If you have any questions about this invoice or the attached detail report, please don't hesitate to contact us.

Thank you for your business!

---
This is an automated email from IrrigoPro
        `,
        Attachments: [
          {
            Name: `Invoice_${invoiceNumber}_Detail.pdf`,
            Content: pdfBase64,
            ContentType: 'application/pdf',
            ContentID: '',
          },
        ],
        Tag: 'invoice-detail-pdf',
      });

      console.log(`Invoice detail PDF sent to ${customerEmail} for invoice ${invoiceNumber}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to send invoice detail PDF:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }
}