import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

// Mock apiRequest so mutations are controlled; reads use pre-seeded cache.
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
  billingNumber: 'WC-2026-0001',
  wetCheckId: 5,
  laborCost: 60,
  partsCost: 30,
  description: 'Wet Check Billing',
  billedDate: null,
  completedDate: null,
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

function makeSeededQueryClient() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Infinity = pre-seeded data is always fresh; queryFns never fire for reads.
        staleTime: Infinity,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });

  // Seed every query the page makes before it mounts.
  qc.setQueryData(['/api/customers', { billingVisible: true }], [mockCustomer]);
  qc.setQueryData(['/api/customers/billing-preview', 'last_30_days', ''], [mockPreview]);
  qc.setQueryData(['/api/customers', 1, 'billing'], mockBillingData);
  qc.setQueryData(['/api/invoices', { limit: 100 }], []);

  return qc;
}

import { apiRequest } from '@/lib/queryClient';
const mockedApiRequest = apiRequest as ReturnType<typeof vi.fn>;

async function renderPage() {
  const qc = makeSeededQueryClient();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WCB in Billing Command Center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('WCB rows appear in the desktop Unbilled tab after selecting a customer', async () => {
    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    await waitFor(() => {
      expect(screen.getAllByText('WC-2026-0001').length).toBeGreaterThan(0);
    }, { timeout: 3000 });

    expect(screen.getAllByText('[WC]').length).toBeGreaterThan(0);
  });

  it('renders all three row types in the item selection dialog', async () => {
    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => {
      expect(screen.getByText('Work Order #10')).toBeTruthy();
      expect(screen.getByText('Billing Sheet #20')).toBeTruthy();
      expect(screen.getAllByText('WC-2026-0001').length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });

  it('Select All selects all three entity types (3 items)', async () => {
    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Clear All'), { timeout: 3000 });

    // Clear first, then Select All
    await act(async () => { fireEvent.click(screen.getByText('Clear All')); });
    await waitFor(() => screen.getByText(/0 item\(s\) selected/), { timeout: 2000 });

    await act(async () => { fireEvent.click(screen.getByText('Select All')); });

    await waitFor(() => {
      expect(screen.getByText(/3 item\(s\) selected/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Clear All clears all three entity type selections', async () => {
    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Select All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Select All')); });
    await waitFor(() => screen.getByText(/3 item\(s\) selected/), { timeout: 2000 });

    await act(async () => { fireEvent.click(screen.getByText('Clear All')); });

    await waitFor(() => {
      expect(screen.getByText(/0 item\(s\) selected/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('WCB checkbox independently toggles wet check billing selection', async () => {
    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Clear All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Clear All')); });
    await waitFor(() => screen.getByText(/0 item\(s\) selected/), { timeout: 2000 });

    // All three checkboxes: WO, BS, WCB. Click only the third one (WCB).
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);

    await act(async () => { fireEvent.click(checkboxes[2]); });

    await waitFor(() => {
      expect(screen.getByText(/1 item\(s\) selected/)).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('Preview POST includes wetCheckBillingIds', async () => {
    const previewResult = {
      invoiceNumber: 'INV-001',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      items: [],
      laborSubtotal: 0,
      partsSubtotal: 0,
      totalAmount: 360,
    };
    mockedApiRequest.mockResolvedValueOnce(previewResult);

    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Select All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Select All')); });
    await waitFor(() => screen.getByText(/3 item\(s\) selected/), { timeout: 2000 });

    const previewBtns = screen.getAllByText(/Preview Invoice/);
    await act(async () => { fireEvent.click(previewBtns[previewBtns.length - 1]); });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        '/api/invoices/preview',
        'POST',
        expect.objectContaining({
          wetCheckBillingIds: expect.arrayContaining([30]),
          workOrderIds: expect.arrayContaining([10]),
          billingSheetIds: expect.arrayContaining([20]),
        })
      );
    }, { timeout: 3000 });
  });

  it('Create POST includes selectedWetCheckBillingIds matching backend param name', async () => {
    const previewResult = {
      invoiceNumber: 'INV-001',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      items: [],
      laborSubtotal: 0,
      partsSubtotal: 0,
      totalAmount: 360,
    };
    const qbConnection = { isConnected: true };
    const createResult = { invoiceNumber: 'INV-001', totalAmount: 360, quickbooksSuccess: false };

    mockedApiRequest
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(qbConnection)
      .mockResolvedValueOnce(createResult);

    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Select All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Select All')); });
    await waitFor(() => screen.getByText(/3 item\(s\) selected/), { timeout: 2000 });

    const previewBtns = screen.getAllByText(/Preview Invoice/);
    await act(async () => { fireEvent.click(previewBtns[previewBtns.length - 1]); });

    await waitFor(() => screen.getByText('Create Invoice & Send to QuickBooks'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Create Invoice & Send to QuickBooks')); });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        '/api/invoices/monthly',
        'POST',
        expect.objectContaining({
          selectedWetCheckBillingIds: expect.arrayContaining([30]),
        })
      );
    }, { timeout: 3000 });
  });

  it('after successful create the invoice dialog is dismissed (WCB selection cleared)', async () => {
    const previewResult = {
      invoiceNumber: 'INV-001',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      items: [],
      laborSubtotal: 0,
      partsSubtotal: 0,
      totalAmount: 360,
    };
    const qbConnection = { isConnected: true };
    const createResult = { invoiceNumber: 'INV-001', totalAmount: 360, quickbooksSuccess: false };

    mockedApiRequest
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(qbConnection)
      .mockResolvedValueOnce(createResult);

    await renderPage();

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Select All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Select All')); });
    await waitFor(() => screen.getByText(/3 item\(s\) selected/), { timeout: 2000 });

    const previewBtns = screen.getAllByText(/Preview Invoice/);
    await act(async () => { fireEvent.click(previewBtns[previewBtns.length - 1]); });

    await waitFor(() => screen.getByText('Create Invoice & Send to QuickBooks'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Create Invoice & Send to QuickBooks')); });

    // Dialog closed after success
    await waitFor(() => {
      expect(screen.queryByText('Create Invoice & Send to QuickBooks')).toBeNull();
    }, { timeout: 3000 });
  });

  it('after successful create /api/wet-check-billings cache is invalidated', async () => {
    const previewResult = {
      invoiceNumber: 'INV-001',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      items: [],
      laborSubtotal: 0,
      partsSubtotal: 0,
      totalAmount: 360,
    };
    const qbConnection = { isConnected: true };
    const createResult = { invoiceNumber: 'INV-001', totalAmount: 360, quickbooksSuccess: false };

    mockedApiRequest
      .mockResolvedValueOnce(previewResult)
      .mockResolvedValueOnce(qbConnection)
      .mockResolvedValueOnce(createResult);

    const { qc } = await renderPage();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const customerBtns = await screen.findAllByText('Test Customer', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(customerBtns[0]); });

    const selectBtns = await screen.findAllByText('Select Items to Invoice', {}, { timeout: 3000 });
    await act(async () => { fireEvent.click(selectBtns[0]); });

    await waitFor(() => screen.getByText('Select All'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Select All')); });
    await waitFor(() => screen.getByText(/3 item\(s\) selected/), { timeout: 2000 });

    const previewBtns = screen.getAllByText(/Preview Invoice/);
    await act(async () => { fireEvent.click(previewBtns[previewBtns.length - 1]); });

    await waitFor(() => screen.getByText('Create Invoice & Send to QuickBooks'), { timeout: 3000 });
    await act(async () => { fireEvent.click(screen.getByText('Create Invoice & Send to QuickBooks')); });

    await waitFor(() => {
      const calledWithWcb = invalidateSpy.mock.calls.some(
        ([opts]) => {
          try { return JSON.stringify(opts)?.includes('/api/wet-check-billings'); }
          catch { return false; }
        }
      );
      expect(calledWithWcb).toBe(true);
    }, { timeout: 3000 });
  });
});
