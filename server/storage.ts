import { 
  companies,
  users,
  customers, 
  parts, 
  assemblies,
  assemblyParts,
  estimates, 
  estimateZones,
  estimateItems,
  propertyZones,
  zones,
  fieldWorkSessions,
  fieldWorkItems,
  workOrders,
  workOrderItems,
  invoices,
  invoiceItems,
  billingSheets,
  billingSheetItems,
  notifications,
  quickbooksIntegration,
  siteMaps,
  controllers,
  irrigationZones,
  partUsage,
  type Company,
  type User,
  type Customer, 
  type Part,
  type Assembly,
  type AssemblyPart, 
  type Estimate, 
  type EstimateZone,
  type EstimateItem,
  type PropertyZone,
  type Zone,
  type FieldWorkSession,
  type FieldWorkItem,
  type WorkOrder,
  type WorkOrderItem,
  type Invoice,
  type InvoiceItem,
  type BillingSheet,
  type BillingSheetItem,
  type Notification,
  type SiteMap,
  type Controller,
  type IrrigationZone,
  type PartUsage,
  type InsertCompany,
  type InsertUser,
  type InsertCustomer, 
  type InsertPart,
  type InsertAssembly,
  type InsertAssemblyPart, 
  type InsertEstimate, 
  type InsertEstimateZone,
  type InsertEstimateItem,
  type InsertPropertyZone,
  type InsertZone,
  type InsertFieldWorkSession,
  type InsertFieldWorkItem,
  type InsertWorkOrder,
  type InsertWorkOrderItem,
  type InsertInvoice,
  type InsertInvoiceItem,
  type InsertBillingSheet,
  type InsertBillingSheetItem,
  type InsertNotification,
  type InsertSiteMap,
  type InsertController,
  type InsertIrrigationZone,
  type InsertPartUsage,
  type EstimateWithItems,
  type EstimateWithZones,
  type PropertyZoneWithZones,
  type FieldWorkSessionWithItems,
  type InvoiceWithItems,
  type BillingSheetWithItems,
  type AssemblyWithParts
} from "@shared/schema";
import { db } from "./db";
import { sql, eq, like, desc, and, gte, lte, or } from "drizzle-orm";
import bcrypt from "bcrypt";

export interface IStorage {
  // Companies
  getCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company | undefined>;
  deleteCompany(id: number): Promise<boolean>;
  
  // Users
  getUsers(companyId?: number): Promise<User[]>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByPasswordResetToken(token: string): Promise<User | undefined>;
  getUserByEmailVerificationToken(token: string): Promise<User | undefined>;
  getUserByRole(role: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  softDeleteUser(id: number): Promise<boolean>;
  getUserDataDependencies(userId: number): Promise<{
    hasWorkOrders: boolean;
    hasBillingSheets: boolean;
    hasNotifications: boolean;
    workOrderCount: number;
    billingSheetCount: number;
    notificationCount: number;
  }>;
  hardDeleteUserWithCascade(userId: number): Promise<boolean>;
  
  // Customers
  getCustomers(companyId?: number): Promise<Customer[]>;
  getCustomer(id: number): Promise<Customer | undefined>;
  createCustomer(customer: InsertCustomer): Promise<Customer>;
  updateCustomer(id: number, customer: Partial<InsertCustomer>): Promise<Customer | undefined>;
  deleteCustomer(id: number): Promise<boolean>;
  
  // Customer-related data
  getEstimatesByCustomer(customerId: number): Promise<Estimate[]>;
  getBillingSheetsByCustomer(customerId: number): Promise<BillingSheetWithItems[]>;
  getBillingSheetsByTechnician(technicianId: number): Promise<BillingSheetWithItems[]>;
  
  // Notifications
  getNotifications(userId: number): Promise<Notification[]>;
  getUnreadNotificationCount(userId: number): Promise<number>;
  createNotification(notification: InsertNotification): Promise<Notification>;
  markNotificationAsRead(id: number): Promise<boolean>;
  markAllNotificationsAsRead(userId: number): Promise<boolean>;

  // Customer Integrations
  syncCustomersFromGoogleSheets(sheetsUrl: string): Promise<{ customersAdded: number }>;
  syncCustomersFromQuickBooks(): Promise<{ customersAdded: number }>;
  getGoogleSheetsCustomerStatus(): Promise<{ isConnected: boolean; lastSync?: string; sheetUrl?: string; customerCount?: number }>;

  // Parts Assemblies
  getAssemblies(companyId: number): Promise<AssemblyWithParts[]>;
  getAssembly(id: number): Promise<AssemblyWithParts | undefined>;
  createAssembly(assembly: InsertAssembly, parts: InsertAssemblyPart[]): Promise<AssemblyWithParts>;
  updateAssembly(id: number, assembly: Partial<InsertAssembly>, parts?: InsertAssemblyPart[]): Promise<AssemblyWithParts | undefined>;
  deleteAssembly(id: number): Promise<boolean>;
  trackAssemblyUsage(companyId: number, assemblyId: number): Promise<void>;
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
  getWorkOrdersByEstimate(estimateId: number): Promise<WorkOrder[]>;
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  createWorkOrderFromEstimate(estimateId: number): Promise<WorkOrder>;
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
  deleteBillingSheetItems(billingSheetId: number): Promise<boolean>;
  updateBillingSheetItem(itemId: number, item: Partial<InsertBillingSheetItem>): Promise<BillingSheetItem | undefined>;
  deleteBillingSheetItem(itemId: number): Promise<boolean>;

  // Invoices - monthly consolidated billing
  getInvoices(): Promise<Invoice[]>;
  getInvoiceById(id: number): Promise<InvoiceWithItems | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: number): Promise<boolean>;
  createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem>;
  getCustomerById(id: number): Promise<Customer | undefined>;


  // Site Maps for customers
  getCustomerSiteMaps(customerId: number): Promise<SiteMap[]>;
  getSiteMapControllers(siteMapId: number): Promise<Controller[]>;
  getSiteMapZones(siteMapId: number): Promise<IrrigationZone[]>;
  createSiteMap(siteMap: InsertSiteMap): Promise<SiteMap>;
  deleteSiteMap(siteMapId: number): Promise<boolean>;
  saveControllers(siteMapId: number, controllers: InsertController[]): Promise<Controller[]>;
  saveZones(siteMapId: number, zones: InsertIrrigationZone[]): Promise<IrrigationZone[]>;

  // Company Profile Management
  getCompanyProfile(companyId: number): Promise<Company | undefined>;
  updateCompanyProfile(companyId: number, updates: Partial<InsertCompany>): Promise<Company>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    // Database initialization - schema is managed by Drizzle
    this.initializeUsers();
  }

  // Company methods
  async getCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(companies.name);
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const result = await db.select().from(companies).where(eq(companies.id, id));
    return result[0];
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const result = await db.insert(companies).values(company).returning();
    return result[0];
  }

  async updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company | undefined> {
    const result = await db.update(companies).set(company).where(eq(companies.id, id)).returning();
    return result[0];
  }

  async deleteCompany(id: number): Promise<boolean> {
    await db.delete(companies).where(eq(companies.id, id));
    return true;
  }

  // Company Profile Management for authenticated company admins
  async getCompanyProfile(companyId: number): Promise<Company | undefined> {
    const result = await db.select().from(companies).where(eq(companies.id, companyId));
    return result[0];
  }

  async updateCompanyProfile(companyId: number, updates: Partial<InsertCompany>): Promise<Company> {
    const result = await db
      .update(companies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companies.id, companyId))
      .returning();
    return result[0];
  }

  async createCompanyProfile(companyData: InsertCompany): Promise<Company> {
    const result = await db
      .insert(companies)
      .values(companyData)
      .returning();
    return result[0];
  }

  async checkCompanyProfileExists(companyId: number): Promise<boolean> {
    const result = await db.select().from(companies).where(eq(companies.id, companyId));
    if (result.length === 0) {
      return false;
    }
    
    const company = result[0];
    // Check if company has proper setup (not just auto-generated placeholder)
    const hasSetupRequiredInName = company.name.includes("(Setup Required)");
    const hasValidName = company.name.trim() !== "";
    const hasValidAddress = Boolean(company.address && company.address.trim() !== "");
    const hasValidEmail = Boolean(company.email && company.email.trim() !== "");
    
    const isSetupComplete = !hasSetupRequiredInName && hasValidName && hasValidAddress && hasValidEmail;
    return isSetupComplete;
  }

  // Initialize fresh system with minimal data for onboarding demo
  private async initializeUsers() {
    try {
      // Check if users already exist
      const existingUsers = await db.select().from(users);
      if (existingUsers.length === 0) {
        // Create a placeholder company first for the demo user
        const demoCompany = await db.insert(companies).values({
          id: 99,
          name: "Demo Company (Setup Required)",
          subscription: "basic",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        // Create only essential users for fresh onboarding experience
        await db.insert(users).values([
          {
            username: "superadmin",
            password: "superadmin123", // In production, this should be hashed
            name: "Super Admin",
            email: "super@system.com",
            role: "super_admin",
            companyId: null, // System level user
            isActive: true,
          },
          {
            username: "randymangel",
            password: "admin123",
            name: "Randy Mangel",
            email: "randy@greenvalley.com",
            role: "company_admin",
            companyId: 99, // Demo company that needs setup
            isActive: true,
          },
        ]);
      }
    } catch (error) {
      console.error("Error initializing users and companies:", error);
    }
  }

  // Users
  async getUsers(companyId?: number): Promise<User[]> {
    const query = db.select().from(users);
    if (companyId !== undefined) {
      // For super_admin (companyId = null), show all users
      // For company users, show only users from their company
      if (companyId === null) {
        return await query;
      } else {
        return await query.where(eq(users.companyId, companyId));
      }
    }
    return await query;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByPasswordResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.passwordResetToken, token));
    return user || undefined;
  }

  async getUserByEmailVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user || undefined;
  }

  async getUserByRole(role: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.role, role));
    return user || undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    // Hash the password before storing
    const hashedPassword = await bcrypt.hash(user.password, 10);
    
    // Generate email verification token if user has email and isn't already verified
    let emailVerificationToken: string | undefined;
    let emailVerificationExpires: Date | undefined;
    
    if (user.email && !user.emailVerified) {
      const crypto = await import('crypto');
      emailVerificationToken = crypto.randomBytes(32).toString('hex');
      emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }
    
    const [newUser] = await db.insert(users).values({
      ...user,
      password: hashedPassword,
      emailVerificationToken,
      emailVerificationExpires
    }).returning();
    
    // Send verification email if user has email and token was generated
    if (newUser.email && emailVerificationToken && !newUser.emailVerified) {
      try {
        const { EmailService } = await import('./email-service');
        await EmailService.sendEmailVerification(newUser.email, emailVerificationToken, newUser.name);
        console.log(`Verification email sent to ${newUser.email} for new user`);
      } catch (emailError) {
        console.error('Failed to send verification email for new user:', emailError);
        // Don't fail user creation if email fails, just log it
      }
    }
    
    return newUser;
  }

  async updateUser(id: number, user: Partial<InsertUser>): Promise<User | undefined> {
    const updateData = { ...user, updatedAt: new Date() };
    const [updatedUser] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    return updatedUser || undefined;
  }

  async updateUserPassword(username: string, hashedPassword: string): Promise<User | undefined> {
    const [updatedUser] = await db.update(users)
      .set({ password: hashedPassword, updatedAt: new Date() })
      .where(eq(users.username, username))
      .returning();
    return updatedUser || undefined;
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Soft delete user - marks as deleted but preserves data integrity
  async softDeleteUser(id: number): Promise<boolean> {
    try {
      const result = await db
        .update(users)
        .set({ 
          isDeleted: true, 
          deletedAt: new Date(),
          isActive: false, // Also deactivate
          updatedAt: new Date()
        })
        .where(eq(users.id, id))
        .returning();
      return result.length > 0;
    } catch (error) {
      console.error('Error soft deleting user:', error);
      return false;
    }
  }

  // Check user's data dependencies before deletion
  async getUserDataDependencies(userId: number): Promise<{
    hasWorkOrders: boolean;
    hasBillingSheets: boolean;
    hasNotifications: boolean;
    workOrderCount: number;
    billingSheetCount: number;
    notificationCount: number;
  }> {
    try {
      // Check work orders (assigned or completed by user)
      const workOrdersAssigned = await db
        .select({ count: sql<number>`count(*)` })
        .from(workOrders)
        .where(eq(workOrders.assignedTechnicianId, userId));
      
      const workOrdersCompleted = await db
        .select({ count: sql<number>`count(*)` })
        .from(workOrders)
        .where(eq(workOrders.completedByUserId, userId));

      // Check billing sheets
      const billingSheetsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(billingSheets)
        .where(eq(billingSheets.technicianId, userId));

      // Check notifications
      const notificationsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(notifications)
        .where(eq(notifications.userId, userId));

      const totalWorkOrders = (workOrdersAssigned[0]?.count || 0) + (workOrdersCompleted[0]?.count || 0);
      const totalBillingSheets = billingSheetsResult[0]?.count || 0;
      const totalNotifications = notificationsResult[0]?.count || 0;

      return {
        hasWorkOrders: totalWorkOrders > 0,
        hasBillingSheets: totalBillingSheets > 0,
        hasNotifications: totalNotifications > 0,
        workOrderCount: totalWorkOrders,
        billingSheetCount: totalBillingSheets,
        notificationCount: totalNotifications
      };
    } catch (error) {
      console.error('Error checking user dependencies:', error);
      return {
        hasWorkOrders: false,
        hasBillingSheets: false,
        hasNotifications: false,
        workOrderCount: 0,
        billingSheetCount: 0,
        notificationCount: 0
      };
    }
  }

  // Hard delete user with cascade handling (use with caution)
  async hardDeleteUserWithCascade(userId: number): Promise<boolean> {
    const transaction = db.transaction(async (tx) => {
      try {
        // Delete notifications
        await tx.delete(notifications).where(eq(notifications.userId, userId));
        
        // Update work orders to remove user references (preserve historical data)
        await tx
          .update(workOrders)
          .set({ 
            assignedTechnicianId: null,
            assignedTechnicianName: `[Deleted User: ${userId}]`
          })
          .where(eq(workOrders.assignedTechnicianId, userId));

        await tx
          .update(workOrders)
          .set({ 
            completedByUserId: null,
            completedByUserName: `[Deleted User: ${userId}]`
          })
          .where(eq(workOrders.completedByUserId, userId));

        // Update billing sheets to preserve historical data
        await tx
          .update(billingSheets)
          .set({ 
            technicianId: null,
            technicianName: `[Deleted User: ${userId}]`
          })
          .where(eq(billingSheets.technicianId, userId));

        // Finally delete the user
        const result = await tx.delete(users).where(eq(users.id, userId));
        
        return (result.rowCount || 0) > 0;
      } catch (error) {
        console.error('Error in hard delete transaction:', error);
        throw error;
      }
    });

    try {
      return await transaction;
    } catch (error) {
      console.error('Transaction failed:', error);
      return false;
    }
  }

  // Customers
  async getCustomers(companyId?: number): Promise<Customer[]> {
    const query = db.select().from(customers);
    if (companyId !== undefined && companyId !== null) {
      return await query.where(eq(customers.companyId, companyId));
    }
    return await query;
  }

  async getCustomer(id: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer || undefined;
  }

  async getCustomerById(id: number): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    return customer || undefined;
  }

  async getCustomerByQuickBooksId(quickbooksId: string): Promise<Customer | undefined> {
    const [customer] = await db.select().from(customers).where(eq(customers.quickbooksId, quickbooksId));
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
    try {
      const [updatedPart] = await db.update(parts).set(part).where(eq(parts.id, id)).returning();
      return updatedPart || undefined;
    } catch (error) {
      console.error(`Database error in updatePart for ID ${id}:`, error);
      console.error(`Data being updated:`, part);
      throw error; // Re-throw to let calling code handle it
    }
  }

  async deletePart(id: number): Promise<boolean> {
    const result = await db.delete(parts).where(eq(parts.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Assembly methods
  async getAssemblies(companyId: number): Promise<AssemblyWithParts[]> {
    const assemblyResults = await db
      .select()
      .from(assemblies)
      .where(and(eq(assemblies.companyId, companyId), eq(assemblies.isActive, true)))
      .orderBy(assemblies.name);

    const assembliesWithParts: AssemblyWithParts[] = [];
    
    for (const assembly of assemblyResults) {
      const partsResults = await db
        .select({
          id: assemblyParts.id,
          assemblyId: assemblyParts.assemblyId,
          partId: assemblyParts.partId,
          quantity: assemblyParts.quantity,
          sortOrder: assemblyParts.sortOrder,
          part: parts
        })
        .from(assemblyParts)
        .innerJoin(parts, eq(assemblyParts.partId, parts.id))
        .where(eq(assemblyParts.assemblyId, assembly.id))
        .orderBy(assemblyParts.sortOrder);

      assembliesWithParts.push({
        ...assembly,
        parts: partsResults
      });
    }

    return assembliesWithParts;
  }

  async getAssembly(id: number): Promise<AssemblyWithParts | undefined> {
    const [assembly] = await db.select().from(assemblies).where(eq(assemblies.id, id));
    if (!assembly) return undefined;

    const partsResults = await db
      .select({
        id: assemblyParts.id,
        assemblyId: assemblyParts.assemblyId,
        partId: assemblyParts.partId,
        quantity: assemblyParts.quantity,
        sortOrder: assemblyParts.sortOrder,
        part: parts
      })
      .from(assemblyParts)
      .innerJoin(parts, eq(assemblyParts.partId, parts.id))
      .where(eq(assemblyParts.assemblyId, assembly.id))
      .orderBy(assemblyParts.sortOrder);

    return {
      ...assembly,
      parts: partsResults
    };
  }

  async createAssembly(assembly: InsertAssembly, partsList: InsertAssemblyPart[]): Promise<AssemblyWithParts> {
    // Calculate totals from parts
    let totalPrice = 0;
    let totalLaborHours = 0;

    for (const assemblyPart of partsList) {
      const [part] = await db.select().from(parts).where(eq(parts.id, assemblyPart.partId));
      if (part) {
        const quantity = parseFloat(assemblyPart.quantity.toString());
        const partPrice = parseFloat(part.price.toString());
        const partLaborHours = parseFloat(part.laborHours.toString());
        
        totalPrice += partPrice * quantity;
        totalLaborHours += partLaborHours * quantity;
      }
    }

    const [newAssembly] = await db
      .insert(assemblies)
      .values({
        ...assembly,
        totalPrice: totalPrice.toFixed(2),
        totalLaborHours: totalLaborHours.toFixed(2)
      })
      .returning();

    // Add parts to assembly
    const assemblyPartsWithId = partsList.map((part, index) => ({
      ...part,
      assemblyId: newAssembly.id,
      quantity: part.quantity.toString(),
      sortOrder: index
    }));

    await db.insert(assemblyParts).values(assemblyPartsWithId);

    // Return the complete assembly with parts
    return this.getAssembly(newAssembly.id) as Promise<AssemblyWithParts>;
  }

  async updateAssembly(id: number, assembly: Partial<InsertAssembly>, partsList?: InsertAssemblyPart[]): Promise<AssemblyWithParts | undefined> {
    const existing = await this.getAssembly(id);
    if (!existing) return undefined;

    // If parts list is provided, recalculate totals
    if (partsList) {
      let totalPrice = 0;
      let totalLaborHours = 0;

      for (const assemblyPart of partsList) {
        const [part] = await db.select().from(parts).where(eq(parts.id, assemblyPart.partId));
        if (part) {
          const quantity = parseFloat(assemblyPart.quantity.toString());
          const partPrice = parseFloat(part.price.toString());
          const partLaborHours = parseFloat(part.laborHours.toString());
          
          totalPrice += partPrice * quantity;
          totalLaborHours += partLaborHours * quantity;
        }
      }

      (assembly as any).totalPrice = totalPrice.toFixed(2);
      (assembly as any).totalLaborHours = totalLaborHours.toFixed(2);

      // Remove existing parts
      await db.delete(assemblyParts).where(eq(assemblyParts.assemblyId, id));

      // Add new parts
      const assemblyPartsWithId = partsList.map((part, index) => ({
        ...part,
        assemblyId: id,
        quantity: part.quantity.toString(),
        sortOrder: index
      }));

      await db.insert(assemblyParts).values(assemblyPartsWithId);
    }

    // Update assembly
    const [updatedAssembly] = await db
      .update(assemblies)
      .set({ ...assembly, updatedAt: new Date() })
      .where(eq(assemblies.id, id))
      .returning();

    return this.getAssembly(updatedAssembly.id) as Promise<AssemblyWithParts>;
  }

  async deleteAssembly(id: number): Promise<boolean> {
    // Delete assembly parts first (foreign key constraint)
    await db.delete(assemblyParts).where(eq(assemblyParts.assemblyId, id));
    
    // Then delete assembly
    const result = await db.delete(assemblies).where(eq(assemblies.id, id));
    return (result.rowCount || 0) > 0;
  }

  async trackAssemblyUsage(companyId: number, assemblyId: number): Promise<void> {
    // Update assembly usage count
    await db
      .update(assemblies)
      .set({ 
        usageCount: sql`${assemblies.usageCount} + 1`,
        updatedAt: new Date()
      })
      .where(eq(assemblies.id, assemblyId));

    // Track in part usage table
    const existingUsage = await db
      .select()
      .from(partUsage)
      .where(and(
        eq(partUsage.companyId, companyId),
        eq(partUsage.assemblyId, assemblyId)
      ));

    if (existingUsage.length > 0) {
      await db
        .update(partUsage)
        .set({
          usageCount: sql`${partUsage.usageCount} + 1`,
          lastUsedAt: new Date(),
          updatedAt: new Date()
        })
        .where(and(
          eq(partUsage.companyId, companyId),
          eq(partUsage.assemblyId, assemblyId)
        ));
    } else {
      await db.insert(partUsage).values({
        companyId,
        assemblyId,
        usageCount: 1,
        lastUsedAt: new Date(),
        updatedAt: new Date()
      });
    }
  }

  async getPartByQuickBooksId(quickbooksId: string): Promise<Part | undefined> {
    try {
      const partsList = await db.select().from(parts).where(eq(parts.quickbooksId, quickbooksId));
      return partsList.length > 0 ? partsList[0] : undefined;
    } catch (error) {
      console.error('Error in getPartByQuickBooksId:', error);
      return undefined;
    }
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
          await db.insert(customers).values({ ...customerData, companyId: 1 });
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
          await db.insert(customers).values({ ...customerData, companyId: 1 });
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

  async saveQuickBooksIntegration(data: { companyId: string; accessToken: string; refreshToken: string; realmId: string; expiresAt: Date }): Promise<void> {
    try {
      // Check if integration already exists
      const existing = await db.select().from(quickbooksIntegration).limit(1);
      
      if (existing.length > 0) {
        // Update existing
        await db.update(quickbooksIntegration)
          .set({
            companyId: data.companyId,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
            realmId: data.realmId,
            expiresAt: data.expiresAt,
            updatedAt: new Date()
          })
          .where(eq(quickbooksIntegration.id, existing[0].id));
      } else {
        // Create new
        await db.insert(quickbooksIntegration).values({
          companyId: data.companyId,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          realmId: data.realmId,
          expiresAt: data.expiresAt,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    } catch (error) {
      console.error('Error saving QuickBooks integration:', error);
      throw error;
    }
  }

  async getQuickBooksIntegration(companyId?: string): Promise<any | null> {
    try {
      let query = db.select().from(quickbooksIntegration);
      
      if (companyId) {
        query = query.where(eq(quickbooksIntegration.companyId, companyId));
      }
      
      const integration = await query.limit(1);
      return integration.length > 0 ? integration[0] : null;
    } catch (error) {
      console.error('Error getting QuickBooks integration:', error);
      return null;
    }
  }

  async getQuickBooksCustomerStatus(companyId?: string): Promise<{ isConnected: boolean; companyName?: string; lastSync?: string; customerCount?: number }> {
    // Check if QuickBooks integration exists for this company
    let integration;
    if (companyId) {
      integration = await db.select().from(quickbooksIntegration).where(eq(quickbooksIntegration.companyId, companyId)).limit(1);
    } else {
      integration = await db.select().from(quickbooksIntegration).limit(1);
    }
    
    const allCustomers = await db.select().from(customers);
    
    if (integration.length === 0) {
      return {
        isConnected: false,
        companyName: undefined,
        lastSync: undefined,
        customerCount: allCustomers.length
      };
    }
    
    const qbIntegration = integration[0];
    const isTokenValid = qbIntegration.expiresAt > new Date();
    
    return {
      isConnected: isTokenValid,
      companyName: qbIntegration.companyId,
      lastSync: qbIntegration.updatedAt?.toISOString() || new Date().toISOString(),
      customerCount: allCustomers.length
    };
  }

  async syncQuickBooksCustomers(): Promise<{ customersAdded: number; customersUpdated: number }> {
    // Check if connected to QuickBooks
    const status = await this.getQuickBooksCustomerStatus();
    if (!status.isConnected) {
      throw new Error("Not connected to QuickBooks. Please connect first.");
    }

    // In a real implementation, this would call QuickBooks API
    // For now, we'll simulate the process with mock data
    const mockQBCustomers = [
      {
        id: "QB001",
        name: "QuickBooks Customer 1",
        email: "customer1@quickbooks.com",
        phone: "555-0001",
        address: "123 QB Street, Denver, CO 80202",
        isActive: true
      },
      {
        id: "QB002", 
        name: "QuickBooks Customer 2",
        email: "customer2@quickbooks.com",
        phone: "555-0002",
        address: "456 QB Avenue, Boulder, CO 80301",
        isActive: true
      },
      {
        id: "QB003",
        name: "Inactive Customer",
        email: "inactive@quickbooks.com", 
        phone: "555-0003",
        address: "789 QB Road, Colorado Springs, CO 80904",
        isActive: false
      }
    ];

    let customersAdded = 0;
    let customersUpdated = 0;

    // Only sync active customers
    for (const qbCustomer of mockQBCustomers.filter(c => c.isActive)) {
      // Check if customer already exists (by name or email)
      const existingCustomer = await db.select()
        .from(customers)
        .where(
          or(
            eq(customers.name, qbCustomer.name),
            eq(customers.email, qbCustomer.email)
          )
        )
        .limit(1);

      if (existingCustomer.length === 0) {
        // Add new customer
        await db.insert(customers).values({
          name: qbCustomer.name,
          email: qbCustomer.email,
          phone: qbCustomer.phone,
          address: qbCustomer.address,
          companyId: 1, // Default company
          laborRate: "45.00",
          markupPercent: "20.00",
          taxPercent: "8.25",
          paymentTerms: "net_30",
          notes: `Synced from QuickBooks (ID: ${qbCustomer.id})`
        });
        customersAdded++;
      } else {
        // Update existing customer with QuickBooks data
        await db.update(customers)
          .set({
            phone: qbCustomer.phone,
            address: qbCustomer.address,
            notes: `Synced from QuickBooks (ID: ${qbCustomer.id})`
          })
          .where(eq(customers.id, existingCustomer[0].id));
        customersUpdated++;
      }
    }

    // Update sync timestamp
    const integration = await db.select().from(quickbooksIntegration).limit(1);
    if (integration.length > 0) {
      await db.update(quickbooksIntegration)
        .set({ updatedAt: new Date() })
        .where(eq(quickbooksIntegration.id, integration[0].id));
    }

    return { customersAdded, customersUpdated };
  }

  async connectQuickBooks(accessToken: string, refreshToken: string, realmId: string, companyId: string): Promise<void> {
    // Store QuickBooks connection
    const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour from now
    
    const existing = await db.select().from(quickbooksIntegration).limit(1);
    
    if (existing.length === 0) {
      await db.insert(quickbooksIntegration).values({
        companyId,
        accessToken,
        refreshToken,
        realmId,
        expiresAt
      });
    } else {
      await db.update(quickbooksIntegration)
        .set({
          companyId,
          accessToken,
          refreshToken,
          realmId,
          expiresAt,
          updatedAt: new Date()
        })
        .where(eq(quickbooksIntegration.id, existing[0].id));
    }
  }

  async disconnectQuickBooks(): Promise<void> {
    await db.delete(quickbooksIntegration);
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

  async getWorkOrdersByEstimate(estimateId: number): Promise<WorkOrder[]> {
    try {
      return await db.select().from(workOrders)
        .where(eq(workOrders.estimateId, estimateId))
        .orderBy(desc(workOrders.createdAt));
    } catch (error) {
      console.error("Error fetching work orders by estimate:", error);
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

  async createWorkOrderFromEstimate(estimateId: number): Promise<WorkOrder> {
    // Get the estimate with its zones and items
    const estimate = await this.getEstimate(estimateId);
    if (!estimate) {
      throw new Error(`Estimate ${estimateId} not found`);
    }
    
    if (estimate.status !== 'approved') {
      throw new Error(`Estimate ${estimateId} must be approved before creating work order`);
    }

    // Check if work order already exists for this estimate
    const existingWorkOrders = await this.getWorkOrdersByEstimate(estimateId);
    if (existingWorkOrders.length > 0) {
      throw new Error(`Work order already exists for estimate ${estimateId}`);
    }

    // Generate work order number
    const workOrderNumber = `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Create the work order
    const workOrderData: InsertWorkOrder = {
      workOrderNumber,
      estimateId: estimateId,
      customerId: estimate.customerId!,
      customerName: estimate.customerName,
      customerEmail: estimate.customerEmail,
      customerPhone: estimate.customerPhone,
      projectName: estimate.projectName,
      projectAddress: estimate.projectAddress,
      locationNotes: estimate.locationNotes,
      accessInstructions: estimate.accessInstructions,
      workType: 'estimate_based',
      status: 'pending',
      priority: 'medium',
      totalAmount: estimate.totalAmount,
      totalItems: estimate.zones?.reduce((sum, zone) => sum + zone.items.length, 0) || 0,
    };

    const [newWorkOrder] = await db.insert(workOrders).values(workOrderData).returning();

    // Copy estimate items to work order items
    if (estimate.zones) {
      for (const zone of estimate.zones) {
        for (const item of zone.items) {
          await db.insert(workOrderItems).values({
            workOrderId: newWorkOrder.id,
            zoneId: zone.id,
            partId: item.partId,
            partName: item.partName,
            partPrice: item.partPrice,
            quantity: item.quantity,
            laborHours: item.laborHours,
            totalPrice: item.totalPrice,
          });
        }
      }
    }

    // Update estimate status to indicate it has been converted
    await db.update(estimates)
      .set({ status: 'converted_to_work_order' })
      .where(eq(estimates.id, estimateId));

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
      workDate: sheetData.workDate ? (sheetData.workDate instanceof Date ? sheetData.workDate : new Date(sheetData.workDate)) : new Date()
    };

    console.log('Creating billing sheet with data:', finalSheetData);
    
    // Generate billing number
    const count = await this.getBillingSheetCount();
    const billingNumber = `BS-${new Date().getFullYear()}-${(count + 1).toString().padStart(4, '0')}`;
    
    const finalSheetDataWithNumber = {
      ...finalSheetData,
      billingNumber
    };
    
    // Remove any timestamp fields that Drizzle manages automatically
    const { createdAt, updatedAt, ...insertData } = finalSheetDataWithNumber;
    
    const [newSheet] = await db.insert(billingSheets).values([insertData]).returning();
    
    // If items are provided, insert them
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await db.insert(billingSheetItems).values({
          ...item,
          billingSheetId: newSheet.id,
          totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString()
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
      totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString()
    }).returning();
    return newItem;
  }

  async updateBillingSheetItem(itemId: number, item: Partial<InsertBillingSheetItem>): Promise<BillingSheetItem | undefined> {
    const updateData = { ...item };
    if (item.quantity && item.unitPrice) {
      updateData.totalPrice = (Number(item.quantity) * Number(item.unitPrice)).toString();
    }
    
    const [updatedItem] = await db.update(billingSheetItems).set(updateData).where(eq(billingSheetItems.id, itemId)).returning();
    return updatedItem || undefined;
  }

  async deleteBillingSheetItem(itemId: number): Promise<boolean> {
    const result = await db.delete(billingSheetItems).where(eq(billingSheetItems.id, itemId));
    return (result.rowCount || 0) > 0;
  }

  async deleteBillingSheetItems(billingSheetId: number): Promise<boolean> {
    const result = await db.delete(billingSheetItems).where(eq(billingSheetItems.billingSheetId, billingSheetId));
    return result.rowCount !== null;
  }

  async getBillingSheetItems(billingSheetId: number): Promise<BillingSheetItem[]> {
    return await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, billingSheetId));
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
    for (const [customerId, work] of Array.from(customerWork.entries())) {
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

  async getInvoiceById(id: number): Promise<InvoiceWithItems | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!invoice) return undefined;
    
    const items = await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, id));
    return { ...invoice, items };
  }

  async getInvoicesByCustomer(customerId: number): Promise<Invoice[]> {
    try {
      return await db.select().from(invoices)
        .where(eq(invoices.customerId, customerId))
        .orderBy(desc(invoices.createdAt));
    } catch (error) {
      // If invoices table doesn't exist or has schema issues, return empty array
      console.warn(`Error querying invoices for customer ${customerId}:`, error);
      return [];
    }
  }

  async getInvoices(): Promise<Invoice[]> {
    return await db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }

  async updateInvoice(id: number, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [updatedInvoice] = await db.update(invoices).set(invoice).where(eq(invoices.id, id)).returning();
    return updatedInvoice || undefined;
  }

  async deleteInvoice(id: number): Promise<boolean> {
    const result = await db.delete(invoices).where(eq(invoices.id, id));
    return (result.rowCount || 0) > 0;
  }

  async createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const [newItem] = await db.insert(invoiceItems).values(item).returning();
    return newItem;
  }

  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  }

  // Notification methods
  async getNotifications(userId: number): Promise<Notification[]> {
    try {
      console.log(`Storage: getNotifications called for userId ${userId}`);
      const results = await db.select().from(notifications)
        .where(eq(notifications.userId, userId))
        .orderBy(desc(notifications.createdAt));
      console.log(`Storage: getNotifications returned ${results.length} notifications`);
      return results;
    } catch (error) {
      console.error(`Storage: getNotifications failed for userId ${userId}:`, error);
      throw error;
    }
  }

  async getUnreadNotificationCount(userId: number): Promise<number> {
    try {
      console.log(`Storage: getUnreadNotificationCount called for userId ${userId}`);
      const results = await db.select().from(notifications)
        .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
      console.log(`Storage: getUnreadNotificationCount returned ${results.length} unread notifications`);
      return results.length;
    } catch (error) {
      console.error(`Storage: getUnreadNotificationCount failed for userId ${userId}:`, error);
      throw error;
    }
  }

  async createNotification(notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  }

  async markNotificationAsRead(id: number): Promise<boolean> {
    const result = await db.update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, id));
    return (result.rowCount || 0) > 0;
  }

  async markAllNotificationsAsRead(userId: number): Promise<boolean> {
    const result = await db.update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return (result.rowCount || 0) > 0;
  }

  // Site Maps methods
  async getAllSiteMaps(): Promise<SiteMap[]> {
    return await db.select().from(siteMaps)
      .where(eq(siteMaps.isActive, true))
      .orderBy(desc(siteMaps.updatedAt));
  }

  async getCustomerSiteMaps(customerId: number): Promise<SiteMap[]> {
    return await db.select().from(siteMaps)
      .where(eq(siteMaps.customerId, customerId))
      .orderBy(desc(siteMaps.updatedAt));
  }

  async getSiteMapControllers(siteMapId: number): Promise<Controller[]> {
    return await db.select().from(controllers)
      .where(eq(controllers.siteMapId, siteMapId))
      .orderBy(controllers.name);
  }

  async getSiteMapZones(siteMapId: number): Promise<IrrigationZone[]> {
    return await db.select().from(irrigationZones)
      .where(eq(irrigationZones.siteMapId, siteMapId))
      .orderBy(irrigationZones.name);
  }

  async createSiteMap(siteMap: InsertSiteMap): Promise<SiteMap> {
    const result = await db.insert(siteMaps).values(siteMap).returning();
    return result[0];
  }

  async updateSiteMap(siteMapId: number, siteMap: Partial<InsertSiteMap>): Promise<SiteMap | undefined> {
    const [updatedSiteMap] = await db.update(siteMaps)
      .set({ ...siteMap, updatedAt: new Date() })
      .where(eq(siteMaps.id, siteMapId))
      .returning();
    return updatedSiteMap || undefined;
  }

  async deleteSiteMap(siteMapId: number): Promise<boolean> {
    const result = await db.delete(siteMaps).where(eq(siteMaps.id, siteMapId));
    return (result.rowCount || 0) > 0;
  }

  async saveControllers(siteMapId: number, controllersData: InsertController[], companyId: number): Promise<Controller[]> {
    // First, delete existing controllers for this site map
    await db.delete(controllers).where(eq(controllers.siteMapId, siteMapId));
    
    // Insert new controllers with proper company ID
    const controllersWithSiteMapId = controllersData.map(controller => ({
      ...controller,
      siteMapId,
      companyId // Use provided company ID
    }));
    
    const result = await db.insert(controllers).values(controllersWithSiteMapId).returning();
    return result;
  }

  async saveZones(siteMapId: number, zonesData: InsertIrrigationZone[], companyId: number): Promise<IrrigationZone[]> {
    if (zonesData.length === 0) return [];
    
    // Get the controller ID from the first zone (they should all be for the same controller)
    const controllerId = zonesData[0].controllerId;
    
    if (controllerId) {
      // Delete existing zones for this specific controller only
      await db.delete(irrigationZones)
        .where(and(
          eq(irrigationZones.siteMapId, siteMapId),
          eq(irrigationZones.controllerId, controllerId)
        ));
    } else {
      // If no controller ID, delete all zones for this site map (fallback)
      await db.delete(irrigationZones).where(eq(irrigationZones.siteMapId, siteMapId));
    }
    
    // Insert new zones with proper company ID
    const zonesWithSiteMapId = zonesData.map(zone => ({
      ...zone,
      siteMapId,
      companyId // Use provided company ID
    }));
    
    const result = await db.insert(irrigationZones).values(zonesWithSiteMapId).returning();
    return result;
  }

  // Part usage tracking methods
  async trackPartUsage(companyId: number, partId: number): Promise<void> {
    const existingUsage = await db.select()
      .from(partUsage)
      .where(and(eq(partUsage.companyId, companyId), eq(partUsage.partId, partId)))
      .limit(1);

    if (existingUsage.length > 0) {
      // Update existing usage
      await db.update(partUsage)
        .set({
          usageCount: existingUsage[0].usageCount + 1,
          lastUsedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(partUsage.id, existingUsage[0].id));
    } else {
      // Create new usage record
      await db.insert(partUsage).values({
        companyId,
        partId,
        usageCount: 1,
        lastUsedAt: new Date()
      });
    }
  }

  async getPopularParts(companyId: number, limit: number = 10): Promise<(Part & { usageCount: number })[]> {
    const results = await db.select({
      id: parts.id,
      companyId: parts.companyId,
      name: parts.name,
      description: parts.description,
      sku: parts.sku,
      category: parts.category,
      price: parts.price,
      laborHours: parts.laborHours,
      usageCount: partUsage.usageCount
    })
    .from(parts)
    .innerJoin(partUsage, eq(parts.id, partUsage.partId))
    .where(eq(partUsage.companyId, companyId))
    .orderBy(desc(partUsage.usageCount), desc(partUsage.lastUsedAt))
    .limit(limit);

    return results;
  }
}

export const storage = new DatabaseStorage();