import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Module mocks (hoisted) ────────────────────────────────────────────────────

vi.mock('@/lib/impersonation', () => ({ getImpersonationToken: () => null }));
vi.mock('@/utils/safeStorage', () => ({
  safeGet: () => null,
  safeSet: () => {},
  safeRemove: () => {},
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/billing/completed-work-detail-modal', () => ({ CompletedWorkDetailModal: () => null }));
vi.mock('@/components/work-orders/work-order-wizard', () => ({ WorkOrderWizard: () => null }));
vi.mock('@/components/billing/billing-sheet-wizard', () => ({ BillingSheetWizard: () => null }));
vi.mock('@/components/billing/invoice-list', () => ({ InvoiceList: () => null }));
vi.mock('@/components/billing/invoice-pdf-preview-modal', () => ({ InvoicePdfPreviewModal: () => null }));
vi.mock('@/components/quickbooks/quickbooks-integration', () => ({ QuickBooksIntegration: () => null }));
vi.mock('@/components/financial-pulse/financial-pulse-widget', () => ({ FinancialPulseWidget: () => null }));
vi.mock('@/components/ui/billed-indicator', () => ({ BilledBadge: () => null, BilledIndicator: () => null }));
vi.mock('@/components/wet-check-billings/wet-check-billing-view-modal', () => ({
  WetCheckBillingViewModal: ({ open, wetCheckBillingId }: { open: boolean; wetCheckBillingId: number }) =>
    open ? <div data-testid={`wcb-modal-${wetCheckBillingId}`}>WCB Modal {wetCheckBillingId}</div> : null,
}));

vi.mock('@/lib/queryClient', async () => {
  const actual = await vi.importActual('@/lib/queryClient');
  return { ...actual, apiRequest: vi.fn() };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockCustomer = {
  id: 1,
  name: 'Test Customer',
  irrigoName: 'Test Customer',
  email: 'test@example.com',
  phone: '555-1234',
  address: '123 Main St',
  hiddenFromBilling: false,
  companyId: 1,
  createdAt: new Date().toISOString(),
};

const mockWorkOrder = {
  id: 10,
  status: 'approved_passed_to_billing',
  description: 'Work Order 10',
  laborCost: 100,
  partsCost: 50,
  assignedTo: 'Tech A',
  billedDate: null,
  completedDate: null,
  hasFinancialBreakdown: true,
  totalAmount: '150',
  scheduledDate: new Date().toISOString(),
  customerId: 1,
  companyId: 1,
  invoiceId: null,
  branchName: null,
  completedAt: null,
};

const mockBillingSheet = {
  id: 20,
  status: 'submitted',
  description: 'Billing Sheet 20',
  laborCost: 80,
  partsCost: 40,
  billedDate: null,
  completedDate: null,
  workDate: new Date().toISOString(),
  customerId: 1,
  companyId: 1,
  invoiceId: null,
  branchName: null,
};

const mockWetCheckBilling = {
  id: 30,
  billingNumber: 'WCB-2026-0001',
  wetCheckId: 5,
  laborCost: 60,
  partsCost: 30,
  description: 'Wet Check Billing',
  billedDate: null,
  completedDate: null,
  status: 'approved_passed_to_billing',
  totalAmount: '90',
  invoiceId: null,
};

const mockBillingData = {
  customer: mockCustomer,
  workOrders: [mockWorkOrder],
  billingSheets: [mockBillingSheet],
  estimates: [],
  wetCheckBillings: [mockWetCheckBilling],
  unbilledWorkOrders: [mockWorkOrder],
  unbilledBillingSheets: [mockBillingSheet],
  unbilledWetCheckBillings: [mockWetCheckBilling],
  totalUnbilledAmount: 360,
};

const mockPreview = {
  id: 1,
  approvedTotal: 150,
  unapprovedTotal: 210,
  combinedTotal: 360,
  totalUnbilled: 360,
  currentMonthUnbilled: 360,
  totalWorkOrders: 1,
  pendingWorkOrders: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSeededQueryClient(billingData = mockBillingData) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });

  qc.setQueryData(['/api/customers', { billingVisible: true }], [mockCustomer]);
  qc.setQueryData(['/api/customers/billing-preview', 'last_30_days', ''], [mockPreview]);
  qc.setQueryData(['/api/customers', 1, 'billing'], billingData);
  qc.setQueryData(['/api/invoices', { limit: 100 }], []);

  return qc;
}

async function renderPage(billingData = mockBillingData) {
  const qc = makeSeededQueryClient(billingData);
  const { default: CustomerBilling } = await import('./customer-billing');

  let container!: HTMLElement;
  await act(async () => {
    ({ container } = render(
      <QueryClientProvider client={qc}>
        <CustomerBilling />
      </QueryClientProvider>
    ));
  });

  return { qc, container };
}

async function selectCustomer() {
  const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
  await act(async () => { fireEvent.click(customerBtns[0]); });
}

async function openDesktopWcbTab() {
  await waitFor(() => screen.getByTestId('tab-trigger-wet-check-billings-desktop'), { timeout: 3000 });
  const trigger = screen.getByTestId('tab-trigger-wet-check-billings-desktop');
  await userEvent.click(trigger);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WCB tab on customer billing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Total Work card shows Wet Check Billings row after selecting a customer', async () => {
    await renderPage();
    await selectCustomer();

    await waitFor(() => {
      expect(screen.getByTestId('total-work-wcb-row')).toBeTruthy();
      expect(screen.getByTestId('total-work-wcb-row').textContent).toContain('Wet Check Billings');
      expect(screen.getByTestId('total-work-wcb-row').textContent).toContain('1');
    }, { timeout: 3000 });
  });

  it('Both tab strips render the WC Billings tab trigger', async () => {
    await renderPage();
    await selectCustomer();

    await waitFor(() => {
      const mobileTrigger = screen.getByTestId('tab-trigger-wet-check-billings');
      const desktopTrigger = screen.getByTestId('tab-trigger-wet-check-billings-desktop');
      expect(mobileTrigger).toBeTruthy();
      expect(desktopTrigger).toBeTruthy();
      expect(mobileTrigger.textContent).toContain('WC Billings');
      expect(desktopTrigger.textContent).toContain('WC Billings');
    }, { timeout: 3000 });
  });

  it('WCB tab renders a WetCheckBillingRow card for each billing entry', async () => {
    await renderPage();
    await selectCustomer();
    await openDesktopWcbTab();

    const row = await screen.findByTestId('wcb-row-30', {}, { timeout: 3000 });
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('WCB-2026-0001');
  });

  it('Clicking a WCB row opens WetCheckBillingViewModal', async () => {
    await renderPage();
    await selectCustomer();
    await openDesktopWcbTab();

    const row = await screen.findByTestId('wcb-row-30', {}, { timeout: 3000 });
    await userEvent.click(row);

    await waitFor(() => {
      expect(screen.getByTestId('wcb-modal-30')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('Empty state card is shown when there are no WCBs', async () => {
    const emptyBillingData = {
      ...mockBillingData,
      wetCheckBillings: [],
      unbilledWetCheckBillings: [],
      totalUnbilledAmount: 240,
    };
    await renderPage(emptyBillingData);
    await selectCustomer();
    await openDesktopWcbTab();

    await waitFor(() => {
      expect(screen.getByText('No wet check billings')).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('Unbilled tab count includes WCBs (unchanged behaviour)', async () => {
    await renderPage();
    await selectCustomer();

    await waitFor(() => {
      const triggers = screen.getAllByText(/Unbilled \(/);
      const hasThreeCount = triggers.some(t => /Unbilled \(3\)/.test(t.textContent ?? ''));
      expect(hasThreeCount).toBe(true);
    }, { timeout: 3000 });
  });
});
