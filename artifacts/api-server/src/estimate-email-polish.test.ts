import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EstimateEmailData } from './email-service';
import { buildEstimateApprovalEmail } from './outgoing-email/estimate-email';

async function render(data: EstimateEmailData) {
  const approvalUrl = `https://irrigopro.com/estimate-approval/${data.approvalToken}`;
  return buildEstimateApprovalEmail(data, {
    approveUrl: approvalUrl,
    rejectUrl: `${approvalUrl}?intent=reject`,
    viewUrl: approvalUrl,
  });
}
const renderHTML = async (data: EstimateEmailData) => (await render(data)).html;
const renderText = async (data: EstimateEmailData) => (await render(data)).text;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStandardData(overrides: Partial<EstimateEmailData> = {}): EstimateEmailData {
  return {
    sender: { from: { email: "billing@example.com", name: "Acme Irrigation" }, replyTo: undefined, usingCompanyAddress: false },
    estimateId: 1,
    estimateNumber: '00001',
    customerName: 'Jane Doe',
    customerLabel: 'Jane Doe',
    companyProfile: null,
    customerEmail: 'jane@example.com',
    projectName: 'Front Yard Sprinklers',
    totalAmount: '$320.00',
    partsSubtotal: 150,
    laborSubtotal: 170,
    totalLaborHours: 2,
    laborRate: 85,
    isInspectionOrigin: false,
    approvalToken: 'abc123',
    estimateDate: '6/1/2026',
    companyId: 7,
    items: [
      {
        description: 'Hunter PGP head',
        partName: 'Hunter PGP',
        quantity: 4,
        partPrice: 25,
        laborHours: 0.5,
        partsCost: 100,
        laborCost: 42.5,
        lineTotal: 142.5,
      },
      {
        description: 'Rainbird valve',
        partName: 'Rainbird 100-HV',
        quantity: 1,
        partPrice: 50,
        laborHours: 1.5,
        partsCost: 50,
        laborCost: 127.5,
        lineTotal: 177.5,
      },
    ],
    ...overrides,
  };
}

function makeInspectionData(): EstimateEmailData {
  return {
    sender: { from: { email: "billing@example.com", name: "Acme Irrigation" }, replyTo: undefined, usingCompanyAddress: false },
    estimateId: 2,
    estimateNumber: '00002',
    customerName: 'John Smith',
    customerLabel: 'John Smith',
    companyProfile: null,
    customerEmail: 'john@example.com',
    projectName: 'Backyard Inspection',
    totalAmount: '$425.00',
    partsSubtotal: 200,
    laborSubtotal: 225,
    totalLaborHours: 2.5,
    laborRate: 90,
    isInspectionOrigin: true,
    approvalToken: 'def456',
    estimateDate: '6/1/2026',
    companyId: 7,
    items: [
      {
        description: 'Head Replace',
        partName: 'Hunter PGP',
        quantity: 2,
        partPrice: 25,
        laborHours: 0.25,
        partsCost: 50,
        laborCost: 22.5,
        lineTotal: 72.5,
        controllerLetter: 'A',
        zoneNumber: 1,
        issueType: 'head_replacement',
      },
      {
        description: 'Valve',
        partName: 'Rainbird Valve',
        quantity: 1,
        partPrice: 75,
        laborHours: 1.5,
        partsCost: 75,
        laborCost: 135,
        lineTotal: 210,
        controllerLetter: 'A',
        zoneNumber: 2,
        issueType: 'valve_issue',
      },
      {
        description: 'Nozzle Replace',
        partName: 'MP Rotator',
        quantity: 5,
        partPrice: 15,
        laborHours: 0.25,
        partsCost: 75,
        laborCost: 22.5,
        lineTotal: 97.5,
        controllerLetter: 'B',
        zoneNumber: 1,
        issueType: 'nozzle_replacement',
      },
    ],
  };
}

describe('estimate email polish', () => {
  it('shows item quantities and combined amounts with separate parts and labor subtotals', async () => {
    const html = await renderHTML(makeStandardData());
    assert.match(html, /Work included/);
    assert.match(html, /Hunter PGP head<\/td>[\s\S]*?>4<\/td>[\s\S]*?>\$142\.50<\/td>/);
    assert.match(html, /Rainbird valve<\/td>[\s\S]*?>1<\/td>[\s\S]*?>\$177\.50<\/td>/);
    assert.match(html, />Parts<\/th>[\s\S]*?>\$150\.00<\/td>/);
    assert.match(html, />Labor · 2 h<\/th>[\s\S]*?>\$170\.00<\/td>/);
    assert.match(html, />Estimate total<\/th>[\s\S]*?>\$320\.00<\/td>/);
    assert.doesNotMatch(html, /Controller [AB] · Zone/);
  });

  it('renders inspection zones as headers within the work table', async () => {
    const html = await renderHTML(makeInspectionData());
    assert.match(html, /Controller A · Zone 1<\/th>[\s\S]*?Head Replace/);
    assert.match(html, /Controller A · Zone 2<\/th>[\s\S]*?Valve/);
    assert.match(html, /Controller B · Zone 1<\/th>[\s\S]*?Nozzle Replace/);
    assert.match(html, /Labor · 2\.5 h/);
  });

  it('links the full estimate to the customer approval page', async () => {
    const html = await renderHTML(makeStandardData({ approvalToken: 'mytoken99' }));
    assert.match(html, /href="https:\/\/irrigopro\.com\/estimate-approval\/mytoken99"[^>]*>View the full estimate online/);
    assert.doesNotMatch(html, /\/api\/estimates\/view-via-token\//);
  });

  it('keeps item amounts, zone headings, and the breakdown in plain text', async () => {
    assert.match(await renderText(makeStandardData()), /- Hunter PGP head × 4  \$142\.50[\s\S]*?Parts: \$150\.00\nLabor · 2 h: \$170\.00/);
    assert.match(await renderText(makeInspectionData()), /Controller A · Zone 1\n- Head Replace × 2  \$72\.50/);
  });
});
