import { 
  customers, 
  parts, 
  estimates, 
  estimateZones,
  estimateItems,
  type Customer, 
  type Part, 
  type Estimate, 
  type EstimateZone,
  type EstimateItem,
  type InsertCustomer, 
  type InsertPart, 
  type InsertEstimate, 
  type InsertEstimateZone,
  type InsertEstimateItem,
  type EstimateWithItems,
  type EstimateWithZones 
} from "@shared/schema";

export interface IStorage {
  // Customers
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: number): Promise<boolean>;

  // Parts
  getParts(): Promise<Part[]>;
  getPart(id: number): Promise<Part | undefined>;
  searchParts(query: string): Promise<Part[]>;
  createPart(part: InsertPart): Promise<Part>;
  updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined>;
  deletePart(id: number): Promise<boolean>;
  syncPartsFromGoogleDocs(docUrl: string): Promise<void>;

  // Estimates
  getEstimates(): Promise<Estimate[]>;
  getEstimate(id: number): Promise<EstimateWithZones | undefined>;
  createEstimate(estimate: InsertEstimate, zones: (InsertEstimateZone & { items: InsertEstimateItem[] })[]): Promise<EstimateWithZones>;
  updateEstimate(id: number, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined>;
  deleteEstimate(id: number): Promise<boolean>;

  // Estimate Items
  getEstimateItems(estimateId: number): Promise<EstimateItem[]>;
  
  // Dashboard Stats
  getDashboardStats(): Promise<{
    pendingEstimates: number;
    approvedThisMonth: number;
    totalRevenue: number;
    partsCount: number;
    recentEstimates: Estimate[];
    topParts: (Part & { usageCount: number })[];
  }>;
}

export class MemStorage implements IStorage {
  private customers: Map<number, Customer> = new Map();
  private parts: Map<number, Part> = new Map();
  private estimates: Map<number, Estimate> = new Map();
  private estimateZones: Map<number, EstimateZone[]> = new Map();
  private estimateItems: Map<number, EstimateItem[]> = new Map();
  private currentCustomerId = 1;
  private currentPartId = 1;
  private currentEstimateId = 1;
  private currentEstimateZoneId = 1;
  private currentEstimateItemId = 1;

  constructor() {
    this.seedData();
  }

  private seedData() {
    // Seed customers
    const sampleCustomers: Customer[] = [
      { id: 1, name: "Johnson Family", email: "johnson@example.com", phone: "(555) 123-4567", address: "123 Oak Street, Springfield, IL 62701" },
      { id: 2, name: "Office Complex Management", email: "manager@officecomplex.com", phone: "(555) 234-5678", address: "456 Business Ave, Springfield, IL 62702" },
      { id: 3, name: "Garden Center LLC", email: "info@gardencenter.com", phone: "(555) 345-6789", address: "789 Garden Way, Springfield, IL 62703" },
      { id: 4, name: "Smith Residence", email: "smith@example.com", phone: "(555) 456-7890", address: "321 Maple Drive, Springfield, IL 62704" },
    ];

    sampleCustomers.forEach(customer => {
      this.customers.set(customer.id, customer);
    });
    this.currentCustomerId = 5;

    // Seed parts
    const sampleParts: Part[] = [
      { id: 1, name: "Rain Bird 5004 Sprinkler", description: "Pop-up spray head with adjustable pattern", price: "18.50", laborHours: "0.50", sku: "RB-5004", category: "Sprinklers" },
      { id: 2, name: "Hunter PGP-ADJ Rotor", description: "Adjustable arc rotary sprinkler", price: "42.75", laborHours: "0.75", sku: "HU-PGP-ADJ", category: "Rotors" },
      { id: 3, name: "1\" PVC Pipe (10ft)", description: "Schedule 40 PVC pipe for irrigation", price: "12.25", laborHours: "0.25", sku: "PVC-1-10", category: "Pipes" },
      { id: 4, name: "Rain Bird ESP-ME Controller", description: "WiFi-enabled irrigation controller", price: "189.00", laborHours: "2.00", sku: "RB-ESP-ME", category: "Controllers" },
      { id: 5, name: "Hunter Pro-Spray Body", description: "Professional grade spray head body", price: "8.75", laborHours: "0.30", sku: "HU-PS-BODY", category: "Sprinklers" },
      { id: 6, name: "Toro Super 800 Nozzle", description: "High-efficiency spray nozzle", price: "3.25", laborHours: "0.10", sku: "TO-S800", category: "Nozzles" },
      { id: 7, name: "Irritrol 2400 Valve", description: "24V AC irrigation valve", price: "32.50", laborHours: "0.60", sku: "IR-2400", category: "Valves" },
      { id: 8, name: "1/2\" Poly Tubing (100ft)", description: "Flexible polyethylene tubing", price: "24.99", laborHours: "0.75", sku: "POLY-05-100", category: "Tubing" },
    ];

    sampleParts.forEach(part => {
      this.parts.set(part.id, part);
    });
    this.currentPartId = 9;

    // Seed estimates
    const sampleEstimates: Estimate[] = [
      {
        id: 1,
        estimateNumber: "EST-2024-001",
        customerId: 1,
        customerName: "Johnson Family",
        customerEmail: "johnson@example.com", 
        customerPhone: "(555) 123-4567",
        projectName: "Residential Sprinkler System",
        projectAddress: "123 Oak Street, Springfield, IL 62701",
        status: "pending",
        partsSubtotal: "450.00",
        laborSubtotal: "562.50",
        markupAmount: "202.50",
        taxAmount: "100.16",
        totalAmount: "1315.16",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        id: 2,
        estimateNumber: "EST-2024-002",
        customerId: 2,
        customerName: "Office Complex Management",
        customerEmail: "manager@officecomplex.com",
        customerPhone: "(555) 234-5678",
        projectName: "Commercial Irrigation",
        projectAddress: "456 Business Ave, Springfield, IL 62702",
        status: "approved",
        partsSubtotal: "1250.00",
        laborSubtotal: "1875.00",
        markupAmount: "625.00",
        taxAmount: "309.38",
        totalAmount: "4059.38",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        id: 3,
        estimateNumber: "EST-2024-003",
        customerId: 3,
        customerName: "Garden Center LLC",
        customerEmail: "info@gardencenter.com",
        customerPhone: "(555) 345-6789",
        projectName: "Drip Irrigation System",
        projectAddress: "789 Garden Way, Springfield, IL 62703",
        status: "pending",
        partsSubtotal: "675.00",
        laborSubtotal: "900.00",
        markupAmount: "315.00",
        taxAmount: "156.08",
        totalAmount: "2046.08",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        id: 4,
        estimateNumber: "EST-2024-004",
        customerId: 4,
        customerName: "Smith Residence",
        customerEmail: "smith@example.com",
        customerPhone: "(555) 456-7890",
        projectName: "Lawn Sprinkler Upgrade",
        projectAddress: "321 Maple Drive, Springfield, IL 62704",
        status: "rejected",
        partsSubtotal: "325.00",
        laborSubtotal: "450.00",
        markupAmount: "155.00",
        taxAmount: "76.73",
        totalAmount: "1006.73",
        laborRate: "75.00",
        markupPercent: "20.00",
        taxPercent: "8.25",
        createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    ];

    sampleEstimates.forEach(estimate => {
      this.estimates.set(estimate.id, estimate);
    });
    this.currentEstimateId = 5;

    // Seed estimate zones
    const sampleEstimateZones = [
      [
        { id: 1, estimateId: 1, zoneName: "Front Yard", workDescription: "Install sprinkler system for front lawn and flower beds", clockInTime: "8:00 AM", sortOrder: 1 },
        { id: 2, estimateId: 1, zoneName: "Back Yard", workDescription: "Install rotor system for large back lawn area", clockInTime: "10:00 AM", sortOrder: 2 },
      ],
      [
        { id: 3, estimateId: 2, zoneName: "Parking Area", workDescription: "Install commercial sprinkler system for landscaping", clockInTime: "7:00 AM", sortOrder: 1 },
        { id: 4, estimateId: 2, zoneName: "Building Perimeter", workDescription: "Install drip irrigation for foundation plantings", clockInTime: "11:00 AM", sortOrder: 2 },
      ],
      [
        { id: 5, estimateId: 3, zoneName: "Greenhouse Area", workDescription: "Install drip irrigation system for greenhouse plants", clockInTime: "9:00 AM", sortOrder: 1 },
      ],
      [
        { id: 6, estimateId: 4, zoneName: "Side Yard", workDescription: "Upgrade existing sprinkler heads", clockInTime: "8:30 AM", sortOrder: 1 },
      ],
    ];

    sampleEstimateZones.forEach((zones, index) => {
      this.estimateZones.set(index + 1, zones);
    });
    this.currentEstimateZoneId = 7;

    // Seed estimate items (now with zone assignments)
    const sampleEstimateItems = [
      [
        { id: 1, estimateId: 1, zoneId: 1, partId: 1, partName: "Rain Bird 5004 Sprinkler", partPrice: "18.50", quantity: 8, laborHours: "4.00", totalPrice: "148.00" },
        { id: 2, estimateId: 1, zoneId: 2, partId: 2, partName: "Hunter PGP-ADJ Rotor", partPrice: "42.75", quantity: 6, laborHours: "4.50", totalPrice: "256.50" },
      ],
      [
        { id: 3, estimateId: 2, zoneId: 3, partId: 1, partName: "Rain Bird 5004 Sprinkler", partPrice: "18.50", quantity: 20, laborHours: "10.00", totalPrice: "370.00" },
        { id: 4, estimateId: 2, zoneId: 4, partId: 4, partName: "Rain Bird ESP-ME Controller", partPrice: "189.00", quantity: 2, laborHours: "4.00", totalPrice: "378.00" },
      ],
      [
        { id: 5, estimateId: 3, zoneId: 5, partId: 8, partName: "1/2\" Poly Tubing (100ft)", partPrice: "24.99", quantity: 10, laborHours: "7.50", totalPrice: "249.90" },
        { id: 6, estimateId: 3, zoneId: 5, partId: 7, partName: "Irritrol 2400 Valve", partPrice: "32.50", quantity: 8, laborHours: "4.80", totalPrice: "260.00" },
      ],
      [
        { id: 7, estimateId: 4, zoneId: 6, partId: 1, partName: "Rain Bird 5004 Sprinkler", partPrice: "18.50", quantity: 8, laborHours: "4.00", totalPrice: "148.00" },
        { id: 8, estimateId: 4, zoneId: 6, partId: 5, partName: "Hunter Pro-Spray Body", partPrice: "8.75", quantity: 6, laborHours: "1.80", totalPrice: "52.50" },
      ],
    ];

    sampleEstimateItems.forEach((items, index) => {
      this.estimateItems.set(index + 1, items);
    });
    this.currentEstimateItemId = 9;
  }

  async getCustomers(): Promise<Customer[]> {
    return Array.from(this.customers.values());
  }

  async getCustomer(id: number): Promise<Customer | undefined> {
    return this.customers.get(id);
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const newCustomer: Customer = {
      id: this.currentCustomerId++,
      name: customer.name,
      email: customer.email,
      phone: customer.phone || null,
      address: customer.address || null,
    };
    this.customers.set(newCustomer.id, newCustomer);
    return newCustomer;
  }

  async updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const existing = this.customers.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...customer };
    this.customers.set(id, updated);
    return updated;
  }

  async deleteCustomer(id: number): Promise<boolean> {
    return this.customers.delete(id);
  }

  async getParts(): Promise<Part[]> {
    return Array.from(this.parts.values());
  }

  async getPart(id: number): Promise<Part | undefined> {
    return this.parts.get(id);
  }

  async searchParts(query: string): Promise<Part[]> {
    const parts = Array.from(this.parts.values());
    const lowercaseQuery = query.toLowerCase();
    return parts.filter(part => 
      part.name.toLowerCase().includes(lowercaseQuery) ||
      part.description?.toLowerCase().includes(lowercaseQuery) ||
      part.sku.toLowerCase().includes(lowercaseQuery)
    );
  }

  async createPart(part: InsertPart): Promise<Part> {
    const newPart: Part = {
      id: this.currentPartId++,
      name: part.name,
      description: part.description || null,
      price: part.price,
      laborHours: part.laborHours,
      sku: part.sku,
      category: part.category || null,
    };
    this.parts.set(newPart.id, newPart);
    return newPart;
  }

  async updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined> {
    const existing = this.parts.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...part };
    this.parts.set(id, updated);
    return updated;
  }

  async deletePart(id: number): Promise<boolean> {
    return this.parts.delete(id);
  }

  async syncPartsFromGoogleDocs(docUrl: string): Promise<void> {
    // This would integrate with Google Docs API to sync parts
    // For now, we'll simulate the functionality
    console.log(`Syncing parts from Google Docs: ${docUrl}`);
    // In a real implementation, this would:
    // 1. Authenticate with Google Docs API
    // 2. Read the document content
    // 3. Parse the parts data
    // 4. Update the parts catalog
  }

  async getEstimates(): Promise<Estimate[]> {
    return Array.from(this.estimates.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getEstimate(id: number): Promise<EstimateWithZones | undefined> {
    const estimate = this.estimates.get(id);
    if (!estimate) return undefined;
    
    const zones = this.estimateZones.get(id) || [];
    const items = this.estimateItems.get(id) || [];
    
    const zonesWithItems = zones.map(zone => ({
      ...zone,
      items: items.filter(item => item.zoneId === zone.id)
    }));
    
    return { ...estimate, zones: zonesWithItems };
  }

  async createEstimate(estimate: InsertEstimate, zones: (InsertEstimateZone & { items: InsertEstimateItem[] })[]): Promise<EstimateWithZones> {
    const estimateNumber = `EST-${new Date().getFullYear()}-${String(this.currentEstimateId).padStart(3, '0')}`;
    const now = new Date();
    
    const newEstimate: Estimate = {
      id: this.currentEstimateId++,
      estimateNumber,
      createdAt: now,
      updatedAt: now,
      customerId: estimate.customerId || null,
      customerName: estimate.customerName,
      customerEmail: estimate.customerEmail,
      customerPhone: estimate.customerPhone || null,
      projectName: estimate.projectName,
      projectAddress: estimate.projectAddress || null,
      status: estimate.status || "pending",
      partsSubtotal: estimate.partsSubtotal,
      laborSubtotal: estimate.laborSubtotal,
      markupAmount: estimate.markupAmount,
      taxAmount: estimate.taxAmount,
      totalAmount: estimate.totalAmount,
      laborRate: estimate.laborRate,
      markupPercent: estimate.markupPercent,
      taxPercent: estimate.taxPercent,
    };
    
    const newZones: EstimateZone[] = zones.map((zone, index) => ({
      id: this.currentEstimateZoneId++,
      estimateId: newEstimate.id,
      zoneName: zone.zoneName,
      workDescription: zone.workDescription || null,
      clockInTime: zone.clockInTime || null,
      sortOrder: zone.sortOrder || index + 1,
    }));
    
    const allNewItems: EstimateItem[] = [];
    zones.forEach((zone, zoneIndex) => {
      const zoneId = newZones[zoneIndex].id;
      zone.items.forEach(item => {
        allNewItems.push({
          id: this.currentEstimateItemId++,
          estimateId: newEstimate.id,
          zoneId: zoneId,
          partId: item.partId,
          partName: item.partName,
          partPrice: item.partPrice,
          quantity: item.quantity,
          laborHours: item.laborHours,
          totalPrice: item.totalPrice,
        });
      });
    });
    
    this.estimates.set(newEstimate.id, newEstimate);
    this.estimateZones.set(newEstimate.id, newZones);
    this.estimateItems.set(newEstimate.id, allNewItems);
    
    const zonesWithItems = newZones.map(zone => ({
      ...zone,
      items: allNewItems.filter(item => item.zoneId === zone.id)
    }));
    
    return { ...newEstimate, zones: zonesWithItems };
  }

  async updateEstimate(id: number, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const existing = this.estimates.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...estimate, updatedAt: new Date() };
    this.estimates.set(id, updated);
    return updated;
  }

  async deleteEstimate(id: number): Promise<boolean> {
    const deleted = this.estimates.delete(id);
    if (deleted) {
      this.estimateItems.delete(id);
    }
    return deleted;
  }

  async getEstimateItems(estimateId: number): Promise<EstimateItem[]> {
    return this.estimateItems.get(estimateId) || [];
  }

  async getDashboardStats(): Promise<{
    pendingEstimates: number;
    approvedThisMonth: number;
    totalRevenue: number;
    partsCount: number;
    recentEstimates: Estimate[];
    topParts: (Part & { usageCount: number })[];
  }> {
    const estimates = Array.from(this.estimates.values());
    const parts = Array.from(this.parts.values());
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();

    const pendingEstimates = estimates.filter(e => e.status === "pending").length;
    
    const approvedThisMonth = estimates.filter(e => 
      e.status === "approved" && 
      new Date(e.createdAt).getMonth() === currentMonth &&
      new Date(e.createdAt).getFullYear() === currentYear
    ).length;

    const totalRevenue = estimates
      .filter(e => e.status === "approved")
      .reduce((sum, e) => sum + parseFloat(e.totalAmount), 0);

    const recentEstimates = estimates
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    // Calculate part usage
    const partUsage = new Map<number, number>();
    Array.from(this.estimateItems.values()).forEach(items => {
      items.forEach(item => {
        partUsage.set(item.partId, (partUsage.get(item.partId) || 0) + item.quantity);
      });
    });

    const topParts = Array.from(partUsage.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([partId, usageCount]) => {
        const part = parts.find(p => p.id === partId);
        return part ? { ...part, usageCount } : null;
      })
      .filter(Boolean) as (Part & { usageCount: number })[];

    return {
      pendingEstimates,
      approvedThisMonth,
      totalRevenue,
      partsCount: parts.length,
      recentEstimates,
      topParts,
    };
  }
}

export const storage = new MemStorage();
