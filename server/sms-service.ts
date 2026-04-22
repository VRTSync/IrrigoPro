import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_FROM_NUMBER;

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

export class SmsService {
  static get isConfigured() {
    return !!(client && fromNumber);
  }

  private static get baseUrl() {
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');
    if (process.env.NODE_ENV === 'production') return 'https://irrigopro.com';
    const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
    if (replitDomain) return `https://${replitDomain}`;
    return `https://${process.env.REPL_ID}.${process.env.REPL_OWNER}.replit.dev`;
  }

  static async sendMissingPhotosTechnicianSms(args: {
    to: string;
    technicianName: string;
    sheets: Array<{ id: number; billingNumber: string }>;
    companyName?: string;
  }): Promise<{ success: boolean; error?: string }> {
    if (!client || !fromNumber) {
      return { success: false, error: 'SMS service not configured (missing Twilio credentials)' };
    }

    const company = args.companyName || 'IrrigoPro';
    const count = args.sheets.length;
    // Technicians cannot access /billing-sheets/missing-photos (manager-only).
    // Deep-link to /billing-sheets with ?ids=… so the tech's billing sheets
    // page filters down to *only* the sheets that lost their photos. The
    // page already restricts the underlying list to the tech's own sheets
    // (see queryFn in client/src/pages/billing-sheets.tsx), so combining
    // tech-scoped data with the id filter yields exactly their affected list.
    const idsParam = args.sheets.map(s => s.id).join(',');
    const reportUrl = `${this.baseUrl}/billing-sheets?ids=${idsParam}`;
    const firstName = (args.technicianName || '').split(' ')[0] || 'there';

    const body =
      `${company}: Hi ${firstName}, ${count} of your billing sheet${count === 1 ? '' : 's'} ` +
      `(${args.sheets.slice(0, 3).map(s => s.billingNumber).join(', ')}` +
      `${count > 3 ? `, +${count - 3} more` : ''}) ` +
      `lost ${count === 1 ? 'its' : 'their'} photos due to a recent bug. ` +
      `If you still have the photos on your phone, please re-attach them: ${reportUrl}`;

    try {
      await client.messages.create({ from: fromNumber, to: args.to, body });
      return { success: true };
    } catch (error) {
      console.error('Failed to send missing-photos SMS:', error);
      const message = error instanceof Error ? error.message : 'Send failed';
      return { success: false, error: message };
    }
  }
}
