import { apiRequest } from "./queryClient";

export interface QuickBooksCustomer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface QuickBooksEstimate {
  id: string;
  docNumber: string;
  txnDate: string;
  customerId: string;
  totalAmount: number;
  status: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    amount: number;
  }>;
}

export interface QuickBooksAuth {
  authUrl: string;
  state: string;
}

export interface QuickBooksConnection {
  companyId: string;
  companyName: string;
  isConnected: boolean;
  lastSync?: string;
}

export const quickbooksService = {
  // Get QuickBooks auth URL
  async getAuthUrl(): Promise<QuickBooksAuth> {
    const response = await apiRequest("GET", "/api/quickbooks/auth-url");
    return response.json();
  },

  // Handle OAuth callback
  async handleCallback(code: string, state: string, realmId: string): Promise<void> {
    const response = await apiRequest("POST", "/api/quickbooks/callback", {
      code,
      state,
      realmId,
    });
    return response.json();
  },

  // Get connection status
  async getConnectionStatus(): Promise<QuickBooksConnection> {
    const response = await apiRequest("GET", "/api/quickbooks/connection-status");
    return response.json();
  },

  // Disconnect from QuickBooks
  async disconnect(): Promise<void> {
    const response = await apiRequest("POST", "/api/quickbooks/disconnect");
    return response.json();
  },

  // Sync single estimate to QuickBooks
  async syncEstimate(estimateId: number): Promise<{ success: boolean; quickbooksId?: string; error?: string }> {
    const response = await apiRequest("POST", `/api/quickbooks/sync-estimate/${estimateId}`);
    return response.json();
  },

  // Sync all estimates to QuickBooks
  async syncAllEstimates(): Promise<{ 
    success: boolean; 
    synced: number; 
    failed: number; 
    errors?: string[] 
  }> {
    const response = await apiRequest("POST", "/api/quickbooks/sync-all-estimates");
    return response.json();
  },

  // Get QuickBooks customers
  async getCustomers(): Promise<QuickBooksCustomer[]> {
    const response = await apiRequest("GET", "/api/quickbooks/customers");
    return response.json();
  },

  // Create customer in QuickBooks
  async createCustomer(customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  }): Promise<QuickBooksCustomer> {
    const response = await apiRequest("POST", "/api/quickbooks/customers", customer);
    return response.json();
  },

  // Get sync status for estimate
  async getEstimateSyncStatus(estimateId: number): Promise<{
    isSync: boolean;
    syncStatus: string;
    quickbooksId?: string;
    lastSyncDate?: string;
    error?: string;
  }> {
    const response = await apiRequest("GET", `/api/quickbooks/estimate-sync-status/${estimateId}`);
    return response.json();
  },

  // Get all sync statuses
  async getAllSyncStatuses(): Promise<Array<{
    estimateId: number;
    syncStatus: string;
    quickbooksId?: string;
    lastSyncDate?: string;
    error?: string;
  }>> {
    const response = await apiRequest("GET", "/api/quickbooks/sync-statuses");
    return response.json();
  },
};