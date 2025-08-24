import { Client } from 'postmark';

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
  zones?: Array<{
    zoneName: string;
    workDescription: string;
    laborHours: number;
    partsCost: number;
    laborCost: number;
    zoneTotal: number;
  }>;
}

export class EmailService {
  private static baseUrl = process.env.NODE_ENV === 'production' 
    ? (process.env.REPLIT_DOMAINS?.includes('irrigopro.com') 
        ? 'https://irrigopro.com' 
        : `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.replit.app`)
    : `https://${process.env.REPL_SLUG || 'irrigopro'}.${process.env.REPL_OWNER || 'rangerrmangel'}.replit.app`;

  static async sendEstimateApprovalEmail(data: EstimateEmailData): Promise<void> {
    if (!process.env.POSTMARK_API_TOKEN) {
      console.error('POSTMARK_API_TOKEN not configured');
      return;
    }

    const approveUrl = `${this.baseUrl}/api/estimates/approve-via-token/${data.approvalToken}`;
    const rejectUrl = `${this.baseUrl}/api/estimates/reject-via-token/${data.approvalToken}`;
    const viewUrl = `${this.baseUrl}/api/estimates/view-via-token/${data.approvalToken}`;

    const htmlContent = this.generateEstimateEmailHTML(data, approveUrl, rejectUrl, viewUrl);
    const textContent = this.generateEstimateEmailText(data, approveUrl, rejectUrl);

    try {
      await client.sendEmail({
        From: process.env.FROM_EMAIL || 'estimates@irrigationcompany.com',
        To: data.customerEmail,
        Subject: `Estimate Approval Required - ${data.estimateNumber}`,
        HtmlBody: htmlContent,
        TextBody: textContent,
        Tag: 'estimate-approval',
        Metadata: {
          estimateId: data.estimateId.toString(),
          estimateNumber: data.estimateNumber
        }
      });

      console.log(`Estimate approval email sent to ${data.customerEmail}`);
    } catch (error) {
      console.error('Failed to send estimate approval email:', error);
      throw error;
    }
  }

  private static generateEstimateEmailHTML(
    data: EstimateEmailData, 
    approveUrl: string, 
    rejectUrl: string, 
    viewUrl: string
  ): string {
    const zonesHTML = data.zones?.map(zone => `
      <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 8px 0;">
        <h4 style="margin: 0 0 8px 0; color: #374151; font-size: 16px;">${zone.zoneName}</h4>
        <p style="margin: 4px 0; color: #6b7280; font-size: 14px;">${zone.workDescription}</p>
        <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 14px;">
          <span>Labor: ${zone.laborHours}h ($${zone.laborCost.toFixed(2)})</span>
          <span>Parts: $${zone.partsCost.toFixed(2)}</span>
          <span style="font-weight: 600;">Total: $${zone.zoneTotal.toFixed(2)}</span>
        </div>
      </div>
    `).join('') || '';

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

    ${zonesHTML ? `
    <div style="margin: 20px 0;">
      <h3 style="color: #374151; margin-bottom: 16px;">Work Zones</h3>
      ${zonesHTML}
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
    rejectUrl: string
  ): string {
    const zonesText = data.zones?.map(zone => 
      `${zone.zoneName}: ${zone.workDescription} - Labor: ${zone.laborHours}h ($${zone.laborCost.toFixed(2)}) + Parts: $${zone.partsCost.toFixed(2)} = $${zone.zoneTotal.toFixed(2)}`
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

${zonesText ? `
WORK ZONES:
${zonesText}
` : ''}

TOTAL ESTIMATE: ${data.totalAmount}

TO RESPOND:
- Approve: ${approveUrl}
- Decline: ${rejectUrl}

Questions? Reply to this email or call us directly.

Thank you for choosing our irrigation services!
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
}