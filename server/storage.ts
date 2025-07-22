import { 
  users,
  customers, 
  parts, 
  estimates, 
  estimateZones,
  estimateItems,
  propertyZones,
  zones,
  fieldWorkSessions,
  fieldWorkItems,
  workOrders,
  workOrderItems,
  billingSheets,
  billingSheetItems,
  type User,
  type Customer, 
  type Part, 
  type Estimate, 
  type EstimateZone,
  type EstimateItem,
  type PropertyZone,
  type Zone,
  type FieldWorkSession,
  type FieldWorkItem,
  type WorkOrder,
  type WorkOrderItem,
  type BillingSheet,
  type BillingSheetItem,
  type InsertUser,
  type InsertCustomer, 
  type InsertPart, 
  type InsertEstimate, 
  type InsertEstimateZone,
  type InsertEstimateItem,
  type InsertPropertyZone,
  type InsertZone,
  type InsertFieldWorkSession,
  type InsertFieldWorkItem,
  type InsertWorkOrder,
  type InsertWorkOrderItem,
  type InsertBillingSheet,
  type InsertBillingSheetItem,
  type EstimateWithItems,
  type EstimateWithZones,
  type PropertyZoneWithZones,
  type FieldWorkSessionWithItems,
  type BillingSheetWithItems
} from "@shared/schema";
import { db } from "./db";
import { eq, like, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUsers(): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByRole(role: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  
  // Customers
  getCustomers(): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: number): Promise<boolean>;
  
  // Customer-related data
  getEstimatesByCustomer(customerId: number): Promise<Estimate[]>;
  getBillingSheetsByCustomer(customerId: number): Promise<BillingSheetWithItems[]>;
  getBillingSheetsByTechnician(technicianId: number): Promise<BillingSheetWithItems[]>;
  
  // Customer Integrations
  syncCustomersFromGoogleSheets(sheetsUrl: string): Promise<{ customersAdded: number }>;
  syncCustomersFromQuickBooks(): Promise<{ customersAdded: number }>;
  getGoogleSheetsCustomerStatus(): Promise<{ isConnected: boolean; lastSync?: string; sheetUrl?: string; customerCount?: number }>;
  getQuickBooksCustomerStatus(): Promise<{ isConnected: boolean; companyName?: string; lastSync?: string; customerCount?: number }>;
  connectGoogleSheetsCustomers(sheetUrl: string): Promise<void>;
  disconnectGoogleSheetsCustomers(): Promise<void>;
  getQuickBooksAuthUrl(): Promise<{ authUrl: string; state: string }>;
  disconnectQuickBooksCustomers(): Promise<void>;

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
  updateEstimateWithZones(id: number, estimate: InsertEstimate, zones: (InsertEstimateZone & { items: InsertEstimateItem[] })[]): Promise<EstimateWithZones>;
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
    workOrderStats: {
      pending: number;
      inProgress: number;
      completed: number;
      total: number;
    };
    recentWorkOrders: WorkOrder[];
  }>;

  // Property Zones
  getPropertyZones(): Promise<PropertyZoneWithZones[]>;
  getPropertyZone(id: number): Promise<PropertyZoneWithZones | undefined>;
  createPropertyZone(propertyZone: InsertPropertyZone): Promise<PropertyZone>;
  updatePropertyZone(id: number, propertyZone: Partial<InsertPropertyZone>): Promise<PropertyZone | undefined>;
  deletePropertyZone(id: number): Promise<boolean>;
  syncPropertyZonesFromGoogleSheets(sheetsUrl: string): Promise<void>;

  // Zones
  getZones(propertyId: number): Promise<Zone[]>;
  createZone(zone: InsertZone): Promise<Zone>;
  updateZone(id: number, zone: Partial<InsertZone>): Promise<Zone | undefined>;
  deleteZone(id: number): Promise<boolean>;

  // Field Work Sessions
  getFieldWorkSessions(): Promise<FieldWorkSessionWithItems[]>;
  getFieldWorkSession(id: number): Promise<FieldWorkSessionWithItems | undefined>;
  createFieldWorkSession(session: InsertFieldWorkSession): Promise<FieldWorkSession>;
  updateFieldWorkSession(id: number, session: Partial<InsertFieldWorkSession>): Promise<FieldWorkSession | undefined>;
  completeFieldWorkSession(id: number): Promise<FieldWorkSession | undefined>;
  deleteFieldWorkSession(id: number): Promise<boolean>;

  // Field Work Items
  getFieldWorkItems(sessionId: number): Promise<FieldWorkItem[]>;
  addFieldWorkItem(item: InsertFieldWorkItem): Promise<FieldWorkItem>;
  updateFieldWorkItem(id: number, item: Partial<InsertFieldWorkItem>): Promise<FieldWorkItem | undefined>;
  deleteFieldWorkItem(id: number): Promise<boolean>;

  // Work Orders - Enhanced
  getWorkOrders(): Promise<WorkOrder[]>;
  getWorkOrdersByTechnician(technicianId: number): Promise<WorkOrder[]>;
  getWorkOrdersByCustomer(customerId: number): Promise<WorkOrder[]>;
  getWorkOrdersByStatus(status: string): Promise<WorkOrder[]>;
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: number): Promise<boolean>;
  assignWorkOrder(workOrderId: number, technicianId: number, technicianName: string): Promise<boolean>;
  
  // Work Order Items
  getWorkOrderItems(workOrderId: number): Promise<WorkOrderItem[]>;
  addWorkOrderItem(item: InsertWorkOrderItem): Promise<WorkOrderItem>;
  updateWorkOrderItem(id: number, item: Partial<InsertWorkOrderItem>): Promise<WorkOrderItem | undefined>;
  deleteWorkOrderItem(id: number): Promise<boolean>;
  
  // Billing Sheets - for work done without work orders
  getAllBillingSheets(): Promise<BillingSheetWithItems[]>;
  getBillingSheetById(id: number): Promise<BillingSheetWithItems | undefined>;
  getBillingSheetCount(): Promise<number>;
  createBillingSheet(billingSheet: InsertBillingSheet & { items?: InsertBillingSheetItem[] }): Promise<BillingSheet>;
  updateBillingSheet(id: number, billingSheet: Partial<InsertBillingSheet>): Promise<BillingSheet | undefined>;
  deleteBillingSheet(id: number): Promise<boolean>;
  addBillingSheetItem(billingSheetId: number, item: InsertBillingSheetItem): Promise<BillingSheetItem>;
  updateBillingSheetItem(itemId: number, item: Partial<InsertBillingSheetItem>): Promise<BillingSheetItem | undefined>;
  deleteBillingSheetItem(itemId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Database initialization - schema is managed by Drizzle
    this.initializeUsers();
  }

  // Initialize default users
  private async initializeUsers() {
    try {
      // Check if users already exist
      const existingUsers = await db.select().from(users);
      if (existingUsers.length === 0) {
        // Create default users
        await db.insert(users).values([
          {
            username: "admin",
            password: "admin123", // In production, this should be hashed
            name: "Admin User",
            email: "admin@irrigation.com",
            role: "admin",
            isActive: true,
          },
          {
            username: "manager",
            password: "manager123",
            name: "Brian Krisher",
            email: "manager@irrigation.com",
            role: "irrigation_manager",
            isActive: true,
          },
          {
            username: "tech",
            password: "tech123",
            name: "JoJo Durrill",
            email: "tech@irrigation.com",
            role: "field_tech",
            isActive: true,
          },
        ]);
      }
    } catch (error) {
      console.error("Error initializing users:", error);
    }
  }

  // Users
  async getUsers(): Promise<User[]> {
    return await db.select().from(users);
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByRole(role: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.role, role));
    return user || undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    const [updatedUser] = await db.update(users).set(user).where(eq(users.id, id)).returning();
    return updatedUser || undefined;
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Customers
  async getCustomers(): Promise<Customer[]> {
    return await db.select().from(customers);
  }

  async getCustomer(id: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer || undefined;
  }

  async createCustomer(customer: InsertCustomer): Promise<Customer> {
    const [newCustomer] = await db.insert(customers).values(customer).returning();
    return newCustomer;
  }

  async updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined> {
    const [updatedCustomer] = await db.update(customers).set(customer).where(eq(customers.id, id)).returning();
    return updatedCustomer || undefined;
  }

  async deleteCustomer(id: number): Promise<boolean> {
    const result = await db.delete(customers).where(eq(customers.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Parts
  async getParts(): Promise<Part[]> {
    return await db.select().from(parts);
  }

  async getPart(id: number): Promise<Part | undefined> {
    const [part] = await db.select().from(parts).where(eq(parts.id, id));
    return part || undefined;
  }

  async searchParts(query: string): Promise<Part[]> {
    return await db.select().from(parts).where(like(parts.name, `%${query}%`));
  }

  async createPart(part: InsertPart): Promise<Part> {
    const [newPart] = await db.insert(parts).values(part).returning();
    return newPart;
  }

  async updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined> {
    const [updatedPart] = await db.update(parts).set(part).where(eq(parts.id, id)).returning();
    return updatedPart || undefined;
  }

  async deletePart(id: number): Promise<boolean> {
    const result = await db.delete(parts).where(eq(parts.id, id));
    return (result.rowCount || 0) > 0;
  }

  async syncPartsFromGoogleDocs(docUrl: string): Promise<void> {
    // Implementation for Google Docs sync would go here
    console.log(`Syncing parts from Google Docs URL: ${docUrl}`);
  }

  // Estimates
  async getEstimates(): Promise<Estimate[]> {
    const estimatesList = await db.select().from(estimates).orderBy(desc(estimates.createdAt));
    
    // Recalculate totals for each estimate to ensure accuracy
    const estimatesWithCalculatedTotals = await Promise.all(
      estimatesList.map(async (estimate) => {
        const zones = await db.select().from(estimateZones).where(eq(estimateZones.estimateId, estimate.id));
        const items = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimate.id));
        
        let partsSubtotal = 0;
        let totalLaborHours = 0;
        
        items.forEach(item => {
          const itemTotal = parseFloat(String(item.totalPrice));
          const itemLaborHours = parseFloat(String(item.laborHours));
          partsSubtotal += itemTotal;
          totalLaborHours += itemLaborHours;
        });
        
        const laborRate = parseFloat(String(estimate.laborRate));
        const markupPercent = parseFloat(String(estimate.markupPercent));
        const taxPercent = parseFloat(String(estimate.taxPercent));
        
        const laborSubtotal = totalLaborHours * laborRate;
        const markupAmount = partsSubtotal * (markupPercent / 100); // Markup only on parts
        const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
        const taxAmount = subtotalWithMarkup * (taxPercent / 100);
        const totalAmount = subtotalWithMarkup + taxAmount;
        
        return {
          ...estimate,
          partsSubtotal: partsSubtotal.toFixed(2),
          laborSubtotal: laborSubtotal.toFixed(2),
          markupAmount: markupAmount.toFixed(2),
          taxAmount: taxAmount.toFixed(2),
          totalAmount: totalAmount.toFixed(2)
        };
      })
    );
    
    return estimatesWithCalculatedTotals;
  }

  async getEstimate(id: number): Promise<EstimateWithZones | undefined> {
    const [estimate] = await db.select().from(estimates).where(eq(estimates.id, id));
    if (!estimate) return undefined;

    const estimateZonesList = await db.select().from(estimateZones).where(eq(estimateZones.estimateId, id));
    const estimateItemsList = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, id));

    const zones = estimateZonesList.map(zone => ({
      ...zone,
      items: estimateItemsList.filter(item => item.zoneId === zone.id)
    }));

    // Recalculate totals to ensure accuracy
    let partsSubtotal = 0;
    let totalLaborHours = 0;
    
    estimateItemsList.forEach(item => {
      const itemTotal = parseFloat(String(item.totalPrice));
      const itemLaborHours = parseFloat(String(item.laborHours));
      partsSubtotal += itemTotal;
      totalLaborHours += itemLaborHours;
    });
    
    const laborRate = parseFloat(String(estimate.laborRate));
    const markupPercent = parseFloat(String(estimate.markupPercent));
    const taxPercent = parseFloat(String(estimate.taxPercent));
    
    const laborSubtotal = totalLaborHours * laborRate;
    const markupAmount = partsSubtotal * (markupPercent / 100); // Markup only on parts
    const subtotalWithMarkup = partsSubtotal + laborSubtotal + markupAmount;
    const taxAmount = subtotalWithMarkup * (taxPercent / 100);
    const totalAmount = subtotalWithMarkup + taxAmount;
    
    const estimateWithCalculatedTotals = {
      ...estimate,
      partsSubtotal: partsSubtotal.toFixed(2),
      laborSubtotal: laborSubtotal.toFixed(2),
      markupAmount: markupAmount.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2)
    };

    return { ...estimateWithCalculatedTotals, zones };
  }

  async createEstimate(estimate: InsertEstimate, zones: (InsertEstimateZone & { items: InsertEstimateItem[] })[]): Promise<EstimateWithZones> {
    // Generate a unique estimate number if not provided
    const estimateNumber = `EST-${Date.now()}`;
    const estimateWithNumber = { ...estimate, estimateNumber };
    const [newEstimate] = await db.insert(estimates).values([estimateWithNumber]).returning();
    
    const createdZones = [];
    for (const zone of zones) {
      const { items, ...zoneData } = zone;
      const [createdZone] = await db.insert(estimateZones).values({
        ...zoneData,
        estimateId: newEstimate.id
      }).returning();

      const createdItems = [];
      for (const item of items) {
        const [createdItem] = await db.insert(estimateItems).values({
          ...item,
          estimateId: newEstimate.id,
          zoneId: createdZone.id
        }).returning();
        createdItems.push(createdItem);
      }

      createdZones.push({ ...createdZone, items: createdItems });
    }

    return { ...newEstimate, zones: createdZones };
  }

  async updateEstimate(id: number, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const [updatedEstimate] = await db.update(estimates).set(estimate).where(eq(estimates.id, id)).returning();
    return updatedEstimate || undefined;
  }

  async updateEstimateWithZones(id: number, estimate: InsertEstimate, zones: (InsertEstimateZone & { items: InsertEstimateItem[] })[]): Promise<EstimateWithZones> {
    // Update the estimate
    const [updatedEstimate] = await db.update(estimates).set(estimate).where(eq(estimates.id, id)).returning();
    
    // Delete existing zones and items for this estimate
    await db.delete(estimateItems).where(eq(estimateItems.estimateId, id));
    await db.delete(estimateZones).where(eq(estimateZones.estimateId, id));
    
    // Create new zones and items
    const createdZones = [];
    for (const zone of zones) {
      const { items, ...zoneData } = zone;
      const [createdZone] = await db.insert(estimateZones).values({
        ...zoneData,
        estimateId: id
      }).returning();

      const createdItems = [];
      for (const item of items) {
        const [createdItem] = await db.insert(estimateItems).values({
          ...item,
          estimateId: id,
          zoneId: createdZone.id
        }).returning();
        createdItems.push(createdItem);
      }

      createdZones.push({ ...createdZone, items: createdItems });
    }

    return { ...updatedEstimate, zones: createdZones };
  }

  async deleteEstimate(id: number): Promise<boolean> {
    const result = await db.delete(estimates).where(eq(estimates.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getEstimateItems(estimateId: number): Promise<EstimateItem[]> {
    return await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId));
  }

  // Property Zones
  async getPropertyZones(): Promise<PropertyZoneWithZones[]> {
    const propertyZonesList = await db.select().from(propertyZones);
    const zonesList = await db.select().from(zones);

    return propertyZonesList.map(property => ({
      ...property,
      zones: zonesList.filter(zone => zone.propertyId === property.id)
    }));
  }

  async getPropertyZone(id: number): Promise<PropertyZoneWithZones | undefined> {
    const [property] = await db.select().from(propertyZones).where(eq(propertyZones.id, id));
    if (!property) return undefined;

    const zonesList = await db.select().from(zones).where(eq(zones.propertyId, id));
    return { ...property, zones: zonesList };
  }

  async createPropertyZone(propertyZone: InsertPropertyZone): Promise<PropertyZone> {
    const [newPropertyZone] = await db.insert(propertyZones).values(propertyZone).returning();
    return newPropertyZone;
  }

  async updatePropertyZone(id: number, propertyZone: Partial<InsertPropertyZone>): Promise<PropertyZone | undefined> {
    const [updatedPropertyZone] = await db.update(propertyZones).set(propertyZone).where(eq(propertyZones.id, id)).returning();
    return updatedPropertyZone || undefined;
  }

  async deletePropertyZone(id: number): Promise<boolean> {
    const result = await db.delete(propertyZones).where(eq(propertyZones.id, id));
    return (result.rowCount || 0) > 0;
  }

  async syncPropertyZonesFromGoogleSheets(sheetsUrl: string): Promise<void> {
    // Implementation for Google Sheets sync would go here
    console.log(`Syncing property zones from Google Sheets URL: ${sheetsUrl}`);
  }

  // Zones
  async getZones(propertyId: number): Promise<Zone[]> {
    return await db.select().from(zones).where(eq(zones.propertyId, propertyId));
  }

  async createZone(zone: InsertZone): Promise<Zone> {
    const [newZone] = await db.insert(zones).values(zone).returning();
    return newZone;
  }

  async updateZone(id: number, zone: Partial<InsertZone>): Promise<Zone | undefined> {
    const [updatedZone] = await db.update(zones).set(zone).where(eq(zones.id, id)).returning();
    return updatedZone || undefined;
  }

  async deleteZone(id: number): Promise<boolean> {
    const result = await db.delete(zones).where(eq(zones.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Field Work Sessions
  async getFieldWorkSessions(): Promise<FieldWorkSessionWithItems[]> {
    const sessions = await db.select().from(fieldWorkSessions).orderBy(desc(fieldWorkSessions.createdAt));
    const items = await db.select().from(fieldWorkItems);

    return sessions.map(session => ({
      ...session,
      items: items.filter(item => item.sessionId === session.id)
    }));
  }

  async getFieldWorkSession(id: number): Promise<FieldWorkSessionWithItems | undefined> {
    const [session] = await db.select().from(fieldWorkSessions).where(eq(fieldWorkSessions.id, id));
    if (!session) return undefined;

    const items = await db.select().from(fieldWorkItems).where(eq(fieldWorkItems.sessionId, id));
    return { ...session, items };
  }

  async createFieldWorkSession(session: InsertFieldWorkSession): Promise<FieldWorkSession> {
    const [newSession] = await db.insert(fieldWorkSessions).values(session).returning();
    return newSession;
  }

  async updateFieldWorkSession(id: number, session: Partial<InsertFieldWorkSession>): Promise<FieldWorkSession | undefined> {
    const [updatedSession] = await db.update(fieldWorkSessions).set(session).where(eq(fieldWorkSessions.id, id)).returning();
    return updatedSession || undefined;
  }

  async completeFieldWorkSession(id: number): Promise<FieldWorkSession | undefined> {
    const [completedSession] = await db.update(fieldWorkSessions).set({
      status: "completed",
      endTime: new Date()
    }).where(eq(fieldWorkSessions.id, id)).returning();
    return completedSession || undefined;
  }

  async deleteFieldWorkSession(id: number): Promise<boolean> {
    const result = await db.delete(fieldWorkSessions).where(eq(fieldWorkSessions.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Field Work Items
  async getFieldWorkItems(sessionId: number): Promise<FieldWorkItem[]> {
    return await db.select().from(fieldWorkItems).where(eq(fieldWorkItems.sessionId, sessionId));
  }

  async addFieldWorkItem(item: InsertFieldWorkItem): Promise<FieldWorkItem> {
    const [newItem] = await db.insert(fieldWorkItems).values(item).returning();
    return newItem;
  }

  async updateFieldWorkItem(id: number, item: Partial<InsertFieldWorkItem>): Promise<FieldWorkItem | undefined> {
    const [updatedItem] = await db.update(fieldWorkItems).set(item).where(eq(fieldWorkItems.id, id)).returning();
    return updatedItem || undefined;
  }

  async deleteFieldWorkItem(id: number): Promise<boolean> {
    const result = await db.delete(fieldWorkItems).where(eq(fieldWorkItems.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Dashboard Stats
  async getDashboardStats(): Promise<{
    pendingEstimates: number;
    approvedThisMonth: number;
    totalRevenue: number;
    partsCount: number;
    recentEstimates: Estimate[];
    topParts: (Part & { usageCount: number })[];
    workOrderStats: {
      pending: number;
      inProgress: number;
      completed: number;
      total: number;
    };
    recentWorkOrders: WorkOrder[];
  }> {
    const allEstimates = await db.select().from(estimates);
    const allParts = await db.select().from(parts);
    const allEstimateItems = await db.select().from(estimateItems);
    const allWorkOrders = await db.select().from(workOrders);

    const pendingEstimates = allEstimates.filter(e => e.status === "pending").length;
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const approvedThisMonth = allEstimates.filter(e => 
      e.status === "approved" && 
      e.createdAt.getMonth() === currentMonth && 
      e.createdAt.getFullYear() === currentYear
    ).length;

    const totalRevenue = allEstimates
      .filter(e => e.status === "approved")
      .reduce((sum, e) => sum + parseFloat(e.totalAmount), 0);

    const partsCount = allParts.length;

    const recentEstimates = allEstimates
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    const recentWorkOrders = allWorkOrders
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 5);

    // Work order stats
    const workOrderStats = {
      pending: allWorkOrders.filter(wo => wo.status === "pending").length,
      inProgress: allWorkOrders.filter(wo => wo.status === "in_progress").length,
      completed: allWorkOrders.filter(wo => wo.status === "completed").length,
      total: allWorkOrders.length
    };

    // Calculate top parts usage
    const partUsage = new Map<number, number>();
    allEstimateItems.forEach(item => {
      const current = partUsage.get(item.partId) || 0;
      partUsage.set(item.partId, current + item.quantity);
    });

    const topParts = allParts
      .map(part => ({
        ...part,
        usageCount: partUsage.get(part.id) || 0
      }))
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5);

    return {
      pendingEstimates,
      approvedThisMonth,
      totalRevenue,
      partsCount,
      recentEstimates,
      topParts,
      workOrderStats,
      recentWorkOrders
    };
  }

  // Customer Integration Methods
  async syncCustomersFromGoogleSheets(sheetsUrl: string): Promise<{ customersAdded: number }> {
    // Mock implementation - in real app, would use Google Sheets API
    console.log(`Syncing customers from Google Sheets: ${sheetsUrl}`);
    
    // Simulate adding customers from Google Sheets
    const mockCustomers = [
      { name: "John Smith", email: "john@example.com", phone: "555-0101", address: "123 Main St, Anytown, USA" },
      { name: "Jane Doe", email: "jane@example.com", phone: "555-0102", address: "456 Oak Ave, Somewhere, USA" }
    ];

    let customersAdded = 0;
    for (const customerData of mockCustomers) {
      try {
        const existing = await db.select().from(customers).where(eq(customers.email, customerData.email));
        if (existing.length === 0) {
          await db.insert(customers).values(customerData);
          customersAdded++;
        }
      } catch (error) {
        console.error(`Failed to add customer ${customerData.name}:`, error);
      }
    }

    return { customersAdded };
  }

  async syncCustomersFromQuickBooks(): Promise<{ customersAdded: number }> {
    // Mock implementation - in real app, would use QuickBooks API
    console.log("Syncing customers from QuickBooks");
    
    // Simulate adding customers from QuickBooks
    const mockCustomers = [
      { name: "ABC Corp", email: "contact@abccorp.com", phone: "555-0201", address: "789 Business Blvd, Corporate City, USA" },
      { name: "XYZ Services", email: "info@xyzservices.com", phone: "555-0202", address: "321 Service Way, Professional Town, USA" }
    ];

    let customersAdded = 0;
    for (const customerData of mockCustomers) {
      try {
        const existing = await db.select().from(customers).where(eq(customers.email, customerData.email));
        if (existing.length === 0) {
          await db.insert(customers).values(customerData);
          customersAdded++;
        }
      } catch (error) {
        console.error(`Failed to add customer ${customerData.name}:`, error);
      }
    }

    return { customersAdded };
  }

  async getGoogleSheetsCustomerStatus(): Promise<{ isConnected: boolean; lastSync?: string; sheetUrl?: string; customerCount?: number }> {
    // Mock implementation - in real app, would store connection status in database
    const allCustomers = await db.select().from(customers);
    return {
      isConnected: false, // Mock: not connected by default
      lastSync: undefined,
      sheetUrl: undefined,
      customerCount: allCustomers.length
    };
  }

  async getQuickBooksCustomerStatus(): Promise<{ isConnected: boolean; companyName?: string; lastSync?: string; customerCount?: number }> {
    // Mock implementation - in real app, would check QuickBooks connection
    const allCustomers = await db.select().from(customers);
    return {
      isConnected: false, // Mock: not connected by default
      companyName: undefined,
      lastSync: undefined,
      customerCount: allCustomers.length
    };
  }

  async connectGoogleSheetsCustomers(sheetUrl: string): Promise<void> {
    // Mock implementation - in real app, would validate and store connection
    console.log(`Connecting to Google Sheets: ${sheetUrl}`);
    // Would store connection info in database
  }

  async disconnectGoogleSheetsCustomers(): Promise<void> {
    // Mock implementation - in real app, would remove connection info
    console.log("Disconnecting Google Sheets");
  }

  async getQuickBooksAuthUrl(): Promise<{ authUrl: string; state: string }> {
    // Mock implementation - in real app, would generate actual QuickBooks OAuth URL
    const state = Math.random().toString(36).substring(2, 15);
    return {
      authUrl: `https://appcenter.intuit.com/connect/oauth2?client_id=YOUR_CLIENT_ID&scope=com.intuit.quickbooks.accounting&redirect_uri=YOUR_REDIRECT_URI&response_type=code&state=${state}`,
      state
    };
  }

  async disconnectQuickBooksCustomers(): Promise<void> {
    // Mock implementation - in real app, would revoke QuickBooks tokens
    console.log("Disconnecting QuickBooks");
  }

  // Work Orders - Enhanced
  async getWorkOrders(): Promise<WorkOrder[]> {
    try {
      return await db.select().from(workOrders).orderBy(desc(workOrders.createdAt));
    } catch (error) {
      console.error("Error fetching work orders:", error);
      // Return empty array instead of error for now
      return [];
    }
  }

  async getWorkOrdersByTechnician(technicianId: number): Promise<WorkOrder[]> {
    try {
      return await db.select().from(workOrders)
        .where(eq(workOrders.assignedTechnicianId, technicianId))
        .orderBy(desc(workOrders.createdAt));
    } catch (error) {
      console.error("Error fetching work orders by technician:", error);
      return [];
    }
  }

  async getWorkOrdersByCustomer(customerId: number): Promise<WorkOrder[]> {
    try {
      return await db.select().from(workOrders)
        .where(eq(workOrders.customerId, customerId))
        .orderBy(desc(workOrders.createdAt));
    } catch (error) {
      console.error("Error fetching work orders by customer:", error);
      return [];
    }
  }

  async getWorkOrdersByStatus(status: string): Promise<WorkOrder[]> {
    try {
      return await db.select().from(workOrders)
        .where(eq(workOrders.status, status))
        .orderBy(desc(workOrders.createdAt));
    } catch (error) {
      console.error("Error fetching work orders by status:", error);
      return [];
    }
  }

  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    return workOrder || undefined;
  }

  async createWorkOrder(workOrder: InsertWorkOrder, estimateZones?: (EstimateZone & { items: EstimateItem[] })[]): Promise<WorkOrder> {
    // Generate work order number
    const workOrderNumber = `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    const [newWorkOrder] = await db.insert(workOrders).values([{
      ...workOrder,
      workOrderNumber,
    }]).returning();

    // Copy estimate items to work order items if provided
    if (estimateZones && estimateZones.length > 0) {
      for (const zone of estimateZones) {
        for (const item of zone.items) {
          await db.insert(workOrderItems).values([{
            workOrderId: newWorkOrder.id,
            zoneId: zone.id,
            partId: item.partId,
            partName: item.partName,
            partPrice: item.partPrice,
            quantity: item.quantity,
            laborHours: item.laborHours,
            totalPrice: item.totalPrice,
          }]);
        }
      }
    }
    
    return newWorkOrder;
  }

  async updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined> {
    const [updatedWorkOrder] = await db.update(workOrders).set(workOrder).where(eq(workOrders.id, id)).returning();
    return updatedWorkOrder || undefined;
  }

  async deleteWorkOrder(id: number): Promise<boolean> {
    const result = await db.delete(workOrders).where(eq(workOrders.id, id));
    return (result.rowCount || 0) > 0;
  }

  async assignWorkOrder(workOrderId: number, technicianId: number, technicianName: string): Promise<boolean> {
    try {
      const [updatedWorkOrder] = await db.update(workOrders)
        .set({
          assignedTechnicianId: technicianId,
          assignedTechnicianName: technicianName,
          status: 'assigned',
        })
        .where(eq(workOrders.id, workOrderId))
        .returning();
      
      return !!updatedWorkOrder;
    } catch (error) {
      console.error("Error assigning work order:", error);
      return false;
    }
  }

  // Work Order Items
  async getWorkOrderItems(workOrderId: number): Promise<WorkOrderItem[]> {
    return await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));
  }

  async addWorkOrderItem(item: InsertWorkOrderItem): Promise<WorkOrderItem> {
    const [newItem] = await db.insert(workOrderItems).values(item).returning();
    return newItem;
  }

  async updateWorkOrderItem(id: number, item: Partial<InsertWorkOrderItem>): Promise<WorkOrderItem | undefined> {
    const [updatedItem] = await db.update(workOrderItems).set(item).where(eq(workOrderItems.id, id)).returning();
    return updatedItem || undefined;
  }

  async deleteWorkOrderItem(id: number): Promise<boolean> {
    const result = await db.delete(workOrderItems).where(eq(workOrderItems.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Standalone Billing Sheets - for work done without work orders
  async getAllBillingSheets(): Promise<BillingSheetWithItems[]> {
    const sheets = await db.select().from(billingSheets).orderBy(desc(billingSheets.createdAt));
    
    // Get items for each billing sheet
    const sheetsWithItems = await Promise.all(sheets.map(async (sheet) => {
      const items = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, sheet.id));
      return { ...sheet, items };
    }));
    
    return sheetsWithItems;
  }

  async getBillingSheetById(id: number): Promise<BillingSheetWithItems | undefined> {
    const [sheet] = await db.select().from(billingSheets).where(eq(billingSheets.id, id));
    if (!sheet) return undefined;
    
    const items = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, id));
    return { ...sheet, items };
  }

  async getBillingSheetCount(): Promise<number> {
    const result = await db.select({ count: billingSheets.id }).from(billingSheets);
    return result.length;
  }

  async createBillingSheet(billingSheetData: InsertBillingSheet & { items?: InsertBillingSheetItem[] }): Promise<BillingSheet> {
    // Extract items from the data
    const { items, ...sheetData } = billingSheetData;
    
    // Calculate totals if they're missing
    let laborSubtotal = Number(sheetData.laborSubtotal || 0);
    let partsSubtotal = Number(sheetData.partsSubtotal || 0);
    let markupAmount = Number(sheetData.markupAmount || 0);
    let taxAmount = Number(sheetData.taxAmount || 0);
    let totalAmount = Number(sheetData.totalAmount || 0);
    
    // If we have items, calculate the totals
    if (items && Array.isArray(items)) {
      partsSubtotal = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
      laborSubtotal = Number(sheetData.totalHours || 0) * Number(sheetData.laborRate || 0);
      
      // Calculate markup (typically on parts)
      const markupPercent = 20; // Default 20% markup
      markupAmount = partsSubtotal * (markupPercent / 100);
      
      // Calculate tax on subtotals + markup
      const taxPercent = 8.25; // Default tax rate
      taxAmount = (laborSubtotal + partsSubtotal + markupAmount) * (taxPercent / 100);
      
      // Total amount
      totalAmount = laborSubtotal + partsSubtotal + markupAmount + taxAmount;
    }

    const finalSheetData = {
      ...sheetData,
      laborSubtotal: laborSubtotal.toString(),
      partsSubtotal: partsSubtotal.toString(),
      markupAmount: markupAmount.toString(),
      taxAmount: taxAmount.toString(),
      totalAmount: totalAmount.toString(),
      workDate: new Date(sheetData.workDate as string)
    };

    console.log('Creating billing sheet with data:', finalSheetData);
    
    const [newSheet] = await db.insert(billingSheets).values(finalSheetData).returning();
    
    // If items are provided, insert them
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await db.insert(billingSheetItems).values({
          ...item,
          billingSheetId: newSheet.id,
          totalPrice: Number(item.quantity) * Number(item.unitPrice)
        });
      }
    }
    
    return newSheet;
  }

  async updateBillingSheet(id: number, billingSheetData: Partial<InsertBillingSheet>): Promise<BillingSheet | undefined> {
    const [updatedSheet] = await db.update(billingSheets).set(billingSheetData).where(eq(billingSheets.id, id)).returning();
    return updatedSheet || undefined;
  }

  async deleteBillingSheet(id: number): Promise<boolean> {
    // Delete items first
    await db.delete(billingSheetItems).where(eq(billingSheetItems.billingSheetId, id));
    
    // Delete the billing sheet
    const result = await db.delete(billingSheets).where(eq(billingSheets.id, id));
    return (result.rowCount || 0) > 0;
  }

  async addBillingSheetItem(billingSheetId: number, item: InsertBillingSheetItem): Promise<BillingSheetItem> {
    const [newItem] = await db.insert(billingSheetItems).values({
      ...item,
      billingSheetId,
      totalPrice: Number(item.quantity) * Number(item.unitPrice)
    }).returning();
    return newItem;
  }

  async updateBillingSheetItem(itemId: number, item: Partial<InsertBillingSheetItem>): Promise<BillingSheetItem | undefined> {
    const updateData = { ...item };
    if (item.quantity && item.unitPrice) {
      updateData.totalPrice = Number(item.quantity) * Number(item.unitPrice);
    }
    
    const [updatedItem] = await db.update(billingSheetItems).set(updateData).where(eq(billingSheetItems.id, itemId)).returning();
    return updatedItem || undefined;
  }

  async deleteBillingSheetItem(itemId: number): Promise<boolean> {
    const result = await db.delete(billingSheetItems).where(eq(billingSheetItems.id, itemId));
    return (result.rowCount || 0) > 0;
  }

  // Customer-related data methods
  async getEstimatesByCustomer(customerId: number): Promise<Estimate[]> {
    return await db.select().from(estimates).where(eq(estimates.customerId, customerId)).orderBy(desc(estimates.createdAt));
  }

  async getBillingSheetsByCustomer(customerId: number): Promise<BillingSheetWithItems[]> {
    const sheets = await db.select().from(billingSheets).where(eq(billingSheets.customerId, customerId)).orderBy(desc(billingSheets.createdAt));
    
    // Get items for each billing sheet
    const sheetsWithItems = await Promise.all(sheets.map(async (sheet) => {
      const items = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, sheet.id));
      return { ...sheet, items };
    }));
    
    return sheetsWithItems;
  }

  async getBillingSheetsByTechnician(technicianId: number): Promise<BillingSheetWithItems[]> {
    const sheets = await db.select().from(billingSheets).where(eq(billingSheets.technicianId, technicianId)).orderBy(desc(billingSheets.createdAt));
    
    // Get items for each billing sheet
    const sheetsWithItems = await Promise.all(sheets.map(async (sheet) => {
      const items = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, sheet.id));
      return { ...sheet, items };
    }));
    
    return sheetsWithItems;
  }

  // Monthly Invoice Consolidation Methods
  async generateMonthlyInvoices(month: number, year: number): Promise<Invoice[]> {
    // Get all completed work orders and approved billing sheets for the month
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59);
    
    // Get completed work orders for the period
    const completedWorkOrders = await db.select()
      .from(workOrders)
      .where(
        and(
          eq(workOrders.status, "completed"),
          gte(workOrders.completedAt, periodStart),
          lte(workOrders.completedAt, periodEnd)
        )
      );
    
    // Get approved billing sheets for the period
    const approvedBillingSheets = await db.select()
      .from(billingSheets)
      .where(
        and(
          eq(billingSheets.status, "approved"),
          gte(billingSheets.workDate, periodStart),
          lte(billingSheets.workDate, periodEnd)
        )
      );
    
    // Group by customer
    const customerWork = new Map<number, { workOrders: any[], billingSheets: any[] }>();
    
    // Group work orders by customer
    completedWorkOrders.forEach(wo => {
      if (!customerWork.has(wo.customerId)) {
        customerWork.set(wo.customerId, { workOrders: [], billingSheets: [] });
      }
      customerWork.get(wo.customerId)!.workOrders.push(wo);
    });
    
    // Group billing sheets by customer
    approvedBillingSheets.forEach(bs => {
      if (bs.customerId) {
        if (!customerWork.has(bs.customerId)) {
          customerWork.set(bs.customerId, { workOrders: [], billingSheets: [] });
        }
        customerWork.get(bs.customerId)!.billingSheets.push(bs);
      }
    });
    
    // Generate invoices for each customer
    const invoices: Invoice[] = [];
    for (const [customerId, work] of customerWork) {
      const invoice = await this.createMonthlyInvoice(customerId, work, month, year, periodStart, periodEnd);
      if (invoice) {
        invoices.push(invoice);
      }
    }
    
    return invoices;
  }

  async createMonthlyInvoice(
    customerId: number, 
    work: { workOrders: any[], billingSheets: any[] },
    month: number,
    year: number,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Invoice | null> {
    // Check if invoice already exists for this customer and period
    const existingInvoice = await db.select()
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.invoiceMonth, month),
          eq(invoices.invoiceYear, year)
        )
      );
    
    if (existingInvoice.length > 0) {
      return existingInvoice[0];
    }
    
    // Get customer details
    const customer = await this.getCustomer(customerId);
    if (!customer) return null;
    
    // Calculate totals from all work
    let partsSubtotal = 0;
    let laborSubtotal = 0;
    
    // Add work order totals
    work.workOrders.forEach(wo => {
      partsSubtotal += parseFloat(wo.totalPartsCost || "0");
      laborSubtotal += parseFloat(wo.totalHours || "0") * parseFloat(customer.laborRate || "45");
    });
    
    // Add billing sheet totals
    work.billingSheets.forEach(bs => {
      partsSubtotal += parseFloat(bs.partsSubtotal || "0");
      laborSubtotal += parseFloat(bs.laborSubtotal || "0");
    });
    
    // Calculate markup and tax
    const markupPercent = parseFloat(customer.markupPercent || "20");
    const taxPercent = parseFloat(customer.taxPercent || "8.25");
    const markupAmount = partsSubtotal * (markupPercent / 100);
    const taxAmount = (partsSubtotal + laborSubtotal + markupAmount) * (taxPercent / 100);
    const totalAmount = partsSubtotal + laborSubtotal + markupAmount + taxAmount;
    
    // Generate invoice number
    const invoiceCount = await this.getInvoiceCount();
    const invoiceNumber = `INV-${year}-${String(month).padStart(2, '0')}-${String(invoiceCount + 1).padStart(3, '0')}`;
    
    // Create invoice
    const [newInvoice] = await db.insert(invoices).values({
      invoiceNumber,
      customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      invoiceMonth: month,
      invoiceYear: year,
      periodStart,
      periodEnd,
      partsSubtotal: partsSubtotal.toString(),
      laborSubtotal: laborSubtotal.toString(),
      markupAmount: markupAmount.toString(),
      taxAmount: taxAmount.toString(),
      totalAmount: totalAmount.toString(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    }).returning();
    
    // Create invoice items from work orders
    for (const wo of work.workOrders) {
      const woItems = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, wo.id));
      for (const item of woItems) {
        await db.insert(invoiceItems).values({
          invoiceId: newInvoice.id,
          sourceType: "work_order",
          sourceId: wo.id,
          workOrderId: wo.id,
          workDate: wo.completedAt || wo.startedAt,
          description: wo.projectName || wo.description,
          partId: item.partId,
          partName: item.partName,
          quantity: item.actualQuantityUsed?.toString() || item.quantity.toString(),
          unitPrice: item.partPrice.toString(),
          totalPrice: ((item.actualQuantityUsed || item.quantity) * parseFloat(item.partPrice)).toString(),
          laborHours: item.actualLaborHours?.toString() || item.laborHours.toString(),
          laborRate: customer.laborRate || "45",
          laborTotal: ((parseFloat(item.actualLaborHours?.toString() || item.laborHours.toString())) * parseFloat(customer.laborRate || "45")).toString(),
        });
      }
    }
    
    // Create invoice items from billing sheets
    for (const bs of work.billingSheets) {
      const bsItems = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, bs.id));
      for (const item of bsItems) {
        await db.insert(invoiceItems).values({
          invoiceId: newInvoice.id,
          sourceType: "billing_sheet",
          sourceId: bs.id,
          billingSheetId: bs.id,
          workDate: bs.workDate,
          description: bs.workDescription,
          partId: item.partId,
          partName: item.partName,
          partDescription: item.partDescription,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          totalPrice: item.totalPrice.toString(),
          laborHours: item.laborHours.toString(),
          laborRate: bs.laborRate.toString(),
          laborTotal: (parseFloat(item.laborHours.toString()) * parseFloat(bs.laborRate.toString())).toString(),
        });
      }
    }
    
    return newInvoice;
  }

  async getInvoiceCount(): Promise<number> {
    const result = await db.select({ count: invoices.id }).from(invoices);
    return result.length;
  }

  async getAllInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getInvoiceById(id: number): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  }
}

export const storage = new DatabaseStorage();