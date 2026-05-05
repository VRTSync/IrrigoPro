import { 
  companies,
  users,
  customers, 
  parts, 
  assemblies,
  assemblyParts,
  estimates, 
  estimateItems,
  propertyZones,
  zones,
  fieldWorkSessions,
  fieldWorkItems,
  workOrders,
  workOrderItems,
  invoices,
  invoiceItems,
  invoicePdfs,
  billingSheets,
  billingSheetItems,
  manualPartReviews,
  missingPhotosNotifications,
  aiGenerationLogs,
  notifications,
  quickbooksIntegration,
  siteMaps,
  controllers,
  irrigationZones,
  partUsage,
  apiKeys,
  partCategories,
  partBrands,
  partSizes,
  partMaterials,
  partFittingTypes,
  pricingAuditEvents,
  type PricingAuditEvent,
  photoLateAdditions,
  type PhotoLateAddition,
  type InsertPhotoLateAddition,
  type Company,
  type User,
  type Customer, 
  type Part,
  type Assembly,
  type AssemblyPart, 
  type Estimate, 
  type EstimateItem,
  type PropertyZone,
  type Zone,
  type FieldWorkSession,
  type FieldWorkItem,
  type WorkOrder,
  type WorkOrderItem,
  type Invoice,
  type InvoiceItem,
  type InvoicePdf,
  type BillingSheet,
  type BillingSheetItem,
  type ManualPartReview,
  type MissingPhotosNotification,
  type AiGenerationLog,
  type Notification,
  type SiteMap,
  type Controller,
  type IrrigationZone,
  type PartUsage,
  type ApiKey,
  type PartCategory,
  type PartBrand,
  type PartSize,
  type PartMaterial,
  type PartFittingType,
  type InsertCompany,
  type InsertUser,
  type InsertCustomer, 
  type InsertPart,
  type InsertAssembly,
  type InsertAssemblyPart, 
  type InsertEstimate, 
  type InsertEstimateItem,
  type InsertPropertyZone,
  type InsertZone,
  type InsertFieldWorkSession,
  type InsertFieldWorkItem,
  type InsertWorkOrder,
  type InsertWorkOrderItem,
  type InsertInvoice,
  type InsertInvoiceItem,
  type InsertInvoicePdf,
  type InsertBillingSheet,
  type InsertBillingSheetItem,
  type InsertManualPartReview,
  type InsertAiGenerationLog,
  type InsertNotification,
  type InsertSiteMap,
  type InsertController,
  type InsertIrrigationZone,
  type InsertPartUsage,
  type InsertApiKey,
  type InsertPartCategory,
  type InsertPartBrand,
  type InsertPartSize,
  type InsertPartMaterial,
  type InsertPartFittingType,
  type EstimateWithItems,
  type PropertyZoneWithZones,
  type FieldWorkSessionWithItems,
  type InvoiceWithItems,
  type BillingSheetWithItems,
  type AssemblyWithParts,
  propertyControllers,
  issueTypeConfigs,
  wetChecks,
  wetCheckZoneRecords,
  wetCheckFindings,
  wetCheckPhotos,
  type PropertyController,
  type InsertPropertyController,
  type IssueTypeConfig,
  type InsertIssueTypeConfig,
  type WetCheck,
  type InsertWetCheck,
  type WetCheckZoneRecord,
  type InsertWetCheckZoneRecord,
  type WetCheckFinding,
  type InsertWetCheckFinding,
  type WetCheckPhoto,
  type InsertWetCheckPhoto,
  type WetCheckWithDetails,
  deriveIssueGroup,
} from "@shared/schema";
import { db } from "./db";
import { sql, eq, like, ilike, desc, and, gte, lte, or, isNull, inArray, gt } from "drizzle-orm";
import bcrypt from "bcrypt";
import { processEstimatePayload, type EstimatePayloadInput } from "./estimate-payload";
import { ObjectStorageService } from "./objectStorage";

// Executor accepted by storage helpers that may run inside a caller's
// transaction. Both `db` and a Drizzle PgTransaction satisfy this
// (insert/update/delete/select are interface-compatible); typing it as the
// transaction parameter type keeps callers honest while still accepting
// the top-level db handle.
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// Thrown by deleteWetCheck when one or more findings have already been
// routed to a billing sheet, estimate or work order. Surface mapped to
// HTTP 409 by the route layer.
export class WetCheckAlreadyRoutedError extends Error {
  routedFindingIds: number[];
  constructor(routedFindingIds: number[]) {
    super(`Wet check has ${routedFindingIds.length} routed finding(s); delete is not allowed`);
    this.name = "WetCheckAlreadyRoutedError";
    this.routedFindingIds = routedFindingIds;
  }
}

// Thrown by deleteWetCheck when one or more downstream records produced
// from the wet check's findings (billing sheets, estimates, work orders,
// or work orders chained off a routed estimate) are already attached to
// an invoice. The route layer maps this to HTTP 409 with a structured
// `blockers` list so the UI can render an actionable message instead of
// silently swallowing the conflict.
export type WetCheckInvoiceBlocker = {
  kind: "billing_sheet" | "estimate" | "work_order";
  id: number;
  displayNumber: string | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
};
export class WetCheckHasInvoicedRecordsError extends Error {
  blockers: WetCheckInvoiceBlocker[];
  constructor(wetCheckId: number, blockers: WetCheckInvoiceBlocker[]) {
    const parts = blockers.map((b) => {
      const kindLabel =
        b.kind === "billing_sheet" ? "billing sheet"
        : b.kind === "estimate" ? "estimate"
        : "work order";
      const recordLabel = b.displayNumber ?? `#${b.id}`;
      const invoiceLabel = b.invoiceNumber ?? (b.invoiceId != null ? `#${b.invoiceId}` : "an invoice");
      return `${kindLabel} ${recordLabel} is on invoice ${invoiceLabel}`;
    });
    const summary = parts.length > 0 ? parts.join("; ") : "downstream record is on an invoice";
    super(`Cannot delete wet check #${wetCheckId}: ${summary}. Remove it from the invoice first.`);
    this.name = "WetCheckHasInvoicedRecordsError";
    this.blockers = blockers;
  }
}

// Thrown by deleteBillingSheet when the sheet has already been pushed onto
// an invoice (either via billing_sheets.invoiceId or via invoice_items rows
// pointing at it). Surface mapped to HTTP 409 by the route layer so the UI
// can show a friendly "already on invoice #..." message instead of a 500.
export class BillingSheetInvoicedError extends Error {
  invoiceNumber: string | null;
  invoiceId: number | null;
  constructor(invoiceId: number | null, invoiceNumber: string | null) {
    super(
      invoiceNumber
        ? `Billing sheet is already on invoice #${invoiceNumber}`
        : `Billing sheet is already on an invoice`,
    );
    this.name = "BillingSheetInvoicedError";
    this.invoiceId = invoiceId;
    this.invoiceNumber = invoiceNumber;
  }
}

// Thrown by setCustomerControllerCount when the requested count would remove
// one or more controllers that still have zoneCount > 0 and the caller did not
// pass `confirmDeleteWithZones: true`. Surface mapped to HTTP 409 by routes.
export class ControllerHasZonesError extends Error {
  letters: string[];
  constructor(letters: string[]) {
    super(`Removing controllers ${letters.join(", ")} would discard zones; confirmation required`);
    this.name = "ControllerHasZonesError";
    this.letters = letters;
  }
}

type DrizzlePartInsert = typeof parts.$inferInsert;
type DrizzleWorkOrderInsert = typeof workOrders.$inferInsert;
type DrizzleInvoiceInsert = typeof invoices.$inferInsert;
type DrizzleCustomerInsert = typeof customers.$inferInsert;
type DrizzleBillingSheetInsert = typeof billingSheets.$inferInsert;

function toDrizzleInsert<TDrizzle>(zodParsed: object): TDrizzle {
  return zodParsed as TDrizzle;
}

export interface IStorage {
  // Companies
  getCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: number, company: Partial<InsertCompany>): Promise<Company | undefined>;
  deleteCompany(id: number): Promise<boolean>;
  
  // Users
  getUsers(companyId?: number, options?: { limit?: number; offset?: number }): Promise<User[]>;
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

  // API Keys for External Integrations
  getApiKeys(companyId: number): Promise<ApiKey[]>;
  getApiKeyByKey(apiKey: string): Promise<ApiKey | undefined>;
  createApiKey(apiKey: InsertApiKey): Promise<ApiKey>;
  deleteApiKey(id: number): Promise<boolean>;
  updateApiKeyLastUsed(id: number): Promise<void>;
  getIrrigationManagerForCompany(companyId: number): Promise<User | undefined>;

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
  getQuickBooksCustomerStatus(): Promise<{ isConnected: boolean; companyName?: string; lastSync?: string; customerCount?: number; connectionStatus?: string; reconnectRequiredReason?: string | null; companyId?: string | null; realmId?: string | null }>;
  getQuickBooksAllIntegrations(): Promise<(typeof quickbooksIntegration.$inferSelect)[]>;
  connectGoogleSheetsCustomers(sheetUrl: string): Promise<void>;
  disconnectGoogleSheetsCustomers(): Promise<void>;
  getQuickBooksAuthUrl(): Promise<{ authUrl: string; state: string }>;
  disconnectQuickBooksCustomers(): Promise<void>;
  markQuickBooksReconnectRequired(realmId: string, reason: string): Promise<void>;
  getAllActiveQuickBooksIntegrations(): Promise<(typeof quickbooksIntegration.$inferSelect)[]>;

  // Parts Reference Lists (per-company: categories, brands, sizes, materials, fitting types)
  getPartCategories(companyId: number): Promise<PartCategory[]>;
  createPartCategory(category: InsertPartCategory): Promise<PartCategory>;
  updatePartCategory(id: number, companyId: number, data: Partial<InsertPartCategory>): Promise<PartCategory | undefined>;
  deletePartCategory(id: number, companyId: number): Promise<boolean>;

  getPartBrands(companyId: number): Promise<PartBrand[]>;
  createPartBrand(brand: InsertPartBrand): Promise<PartBrand>;
  updatePartBrand(id: number, companyId: number, data: Partial<InsertPartBrand>): Promise<PartBrand | undefined>;
  deletePartBrand(id: number, companyId: number): Promise<boolean>;

  getPartSizes(companyId: number): Promise<PartSize[]>;
  createPartSize(size: InsertPartSize): Promise<PartSize>;
  updatePartSize(id: number, companyId: number, data: Partial<InsertPartSize>): Promise<PartSize | undefined>;
  deletePartSize(id: number, companyId: number): Promise<boolean>;

  getPartMaterials(companyId: number): Promise<PartMaterial[]>;
  createPartMaterial(material: InsertPartMaterial): Promise<PartMaterial>;
  updatePartMaterial(id: number, companyId: number, data: Partial<InsertPartMaterial>): Promise<PartMaterial | undefined>;
  deletePartMaterial(id: number, companyId: number): Promise<boolean>;

  getPartFittingTypes(companyId: number): Promise<PartFittingType[]>;
  createPartFittingType(fittingType: InsertPartFittingType): Promise<PartFittingType>;
  updatePartFittingType(id: number, companyId: number, data: Partial<InsertPartFittingType>): Promise<PartFittingType | undefined>;
  deletePartFittingType(id: number, companyId: number): Promise<boolean>;

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
  getEstimatesPendingApproval(companyId: number | null): Promise<Estimate[]>;
  getEstimate(id: number): Promise<EstimateWithItems | undefined>;
  createEstimate(estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<EstimateWithItems>;
  updateEstimate(id: number, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined>;
  updateEstimateWithItems(id: number, estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<EstimateWithItems>;
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
      assigned: number;
      pendingManagerReview: number;
      total: number;
    };
    billingSheetStats: {
      pendingManagerReview: number;
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
  createWorkOrder(workOrder: InsertWorkOrder, estimateItems?: EstimateItem[]): Promise<WorkOrder>;
  createWorkOrderFromEstimate(estimateId: number): Promise<WorkOrder>;
  updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: number): Promise<boolean>;
  hasInvoiceItems(workOrderId: number): Promise<boolean>;
  assignWorkOrder(workOrderId: number, technicianId: number, technicianName: string): Promise<boolean>;
  // Task #185 — flag a work order as not requiring photos so it disappears
  // from the missing-photos report. Stamps the acting user and timestamp.
  markWorkOrderNoPhotosNeeded(workOrderId: number, userId: number): Promise<WorkOrder | undefined>;
  // Task #187 — undo the "no photos needed" flag, clearing the three audit
  // fields so the work order can reappear on the missing-photos report.
  clearWorkOrderNoPhotosNeeded(workOrderId: number): Promise<WorkOrder | undefined>;
  
  // Work Order Items
  getWorkOrderItems(workOrderId: number): Promise<WorkOrderItem[]>;
  addWorkOrderItem(item: InsertWorkOrderItem): Promise<WorkOrderItem>;
  updateWorkOrderItem(id: number, item: Partial<InsertWorkOrderItem>): Promise<WorkOrderItem | undefined>;
  deleteWorkOrderItem(id: number): Promise<boolean>;
  deleteWorkOrderItems(workOrderId: number): Promise<boolean>;
  replaceWorkOrderItemsInTransaction(workOrderId: number, items: InsertWorkOrderItem[]): Promise<WorkOrderItem[]>;
  
  // Billing Sheets - for work done without work orders
  getAllBillingSheets(): Promise<BillingSheetWithItems[]>;
  getBillingSheetById(id: number): Promise<BillingSheetWithItems | undefined>;
  getNextBillingNumber(): Promise<string>;
  createBillingSheet(billingSheet: InsertBillingSheet & { items?: InsertBillingSheetItem[] }): Promise<BillingSheet>;
  updateBillingSheet(id: number, billingSheet: Partial<InsertBillingSheet>): Promise<BillingSheet | undefined>;
  deleteBillingSheet(id: number): Promise<boolean>;
  addBillingSheetItem(billingSheetId: number, item: InsertBillingSheetItem): Promise<BillingSheetItem>;
  deleteBillingSheetItems(billingSheetId: number): Promise<boolean>;
  updateBillingSheetItem(itemId: number, item: Partial<InsertBillingSheetItem>): Promise<BillingSheetItem | undefined>;
  deleteBillingSheetItem(itemId: number): Promise<boolean>;
  replaceBillingSheetItemsInTransaction(billingSheetId: number, items: InsertBillingSheetItem[]): Promise<BillingSheetItem[]>;
  replaceBillingSheetItemsAndResync(billingSheetId: number, items: InsertBillingSheetItem[]): Promise<{ items: BillingSheetItem[]; partsSubtotal: string; totalAmount: string }>;
  // Task #197 — flag a billing sheet as not requiring photos so it disappears
  // from the missing-photos report. Stamps the acting user and timestamp.
  markBillingSheetNoPhotosNeeded(sheetId: number, userId: number): Promise<BillingSheet | undefined>;

  // Missing-photos outreach tracking — one row per technician
  getMissingPhotosNotifications(): Promise<MissingPhotosNotification[]>;
  upsertMissingPhotosNotification(technicianId: number, sheetIds: number[], sentByUserId: number | null, channel?: 'email' | 'sms', smsMessageSid?: string | null): Promise<MissingPhotosNotification>;
  updateMissingPhotosSmsStatus(messageSid: string, status: string, errorCode?: string | null): Promise<MissingPhotosNotification | undefined>;

  // Invoices - monthly consolidated billing
  getInvoices(): Promise<Invoice[]>;
  getInvoiceById(id: number): Promise<InvoiceWithItems | undefined>;
  createInvoice(invoice: InsertInvoice & { invoiceNumber?: string }): Promise<Invoice>;
  updateInvoice(id: number, invoice: Partial<InsertInvoice> & { invoiceNumber?: string }): Promise<Invoice | undefined>;
  deleteInvoice(id: number): Promise<boolean>;
  deleteInvoiceItemsByInvoiceId(invoiceId: number): Promise<boolean>;
  createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem>;
  getCustomerById(id: number): Promise<Customer | undefined>;
  
  // Invoice PDFs - detailed breakdowns
  createInvoicePdf(pdf: InsertInvoicePdf): Promise<InvoicePdf>;
  getInvoicePdfByInvoiceId(invoiceId: number): Promise<InvoicePdf | undefined>;
  updateInvoicePdf(id: number, pdf: Partial<InsertInvoicePdf>): Promise<InvoicePdf | undefined>;


  // Site Maps for customers
  getCustomerSiteMaps(customerId: number): Promise<SiteMap[]>;
  getSiteMapControllers(siteMapId: number): Promise<Controller[]>;
  getSiteMapZones(siteMapId: number): Promise<IrrigationZone[]>;
  createSiteMap(siteMap: InsertSiteMap): Promise<SiteMap>;
  deleteSiteMap(siteMapId: number): Promise<boolean>;
  saveControllers(siteMapId: number, controllers: InsertController[], companyId?: number): Promise<Controller[]>;
  saveZones(siteMapId: number, zones: InsertIrrigationZone[], companyId?: number): Promise<IrrigationZone[]>;

  // Catalog $0-price audit / backfill (Tasks #160 + #161) — covers billing sheets,
  // work orders, AND invoice line items.
  getZeroPriceCatalogItems(companyId: number | null): Promise<Array<{
    source: 'billing_sheet' | 'work_order' | 'invoice';
    itemId: number;
    parentId: number;          // billingSheetId / workOrderId / invoiceId
    parentNumber: string;      // billingNumber / workOrderNumber / invoiceNumber
    customerId: number | null;
    customerName: string;
    workDate: Date | null;
    technicianName: string;
    status: string;
    invoiceId: number | null;
    partId: number;
    partName: string;
    quantity: string;
    storedUnitPrice: string;
    storedTotalPrice: string;
    catalogUnitPrice: string;
    expectedTotalPrice: string;
    difference: string;
  }>>;
  repriceBillingSheetItems(
    selection: Array<{ source: 'billing_sheet' | 'work_order' | 'invoice'; itemId: number }>,
    companyId: number | null,
    options: { dryRun: boolean; performedByUserId: number | null; performedByName: string | null }
  ): Promise<{
    dryRun: boolean;
    parentCount: number;
    itemCount: number;
    totalDifference: string;
    parents: Array<{
      source: 'billing_sheet' | 'work_order' | 'invoice';
      parentId: number;
      parentNumber: string;
      oldPartsSubtotal: string;
      newPartsSubtotal: string;
      oldTotalAmount: string;
      newTotalAmount: string;
      updatedItems: Array<{
        itemId: number;
        partName: string;
        oldUnitPrice: string;
        newUnitPrice: string;
        oldTotalPrice: string;
        newTotalPrice: string;
      }>;
    }>;
  }>;

  // Labor rate mismatch audit (Task #200) — un-invoiced WO + BS whose
  // stored labor rate no longer matches the customer's current standard
  // OR emergency rate. The "inferred classification" is whichever current
  // rate the stored rate is numerically closer to.
  getLaborRateMismatchTickets(companyId: number | null): Promise<Array<{
    source: 'work_order' | 'billing_sheet';
    parentId: number;
    parentNumber: string;
    customerId: number | null;
    customerName: string;
    workDate: Date | null;
    technicianName: string;
    status: string;
    totalHours: string;
    storedLaborRate: string;
    storedLaborSubtotal: string;
    storedPartsSubtotal: string;
    storedTotalAmount: string;
    customerStandardRate: string;
    customerEmergencyRate: string;
    inferredClassification: 'standard' | 'emergency';
    expectedLaborRate: string;
    expectedLaborSubtotal: string;
    expectedTotalAmount: string;
  }>>;
  repriceLaborRateMismatches(
    selection: Array<{ source: 'work_order' | 'billing_sheet'; parentId: number; classification: 'standard' | 'emergency' }>,
    companyId: number | null,
    options: { dryRun: boolean; performedByUserId: number | null; performedByName: string | null }
  ): Promise<{
    dryRun: boolean;
    parentCount: number;
    totalDifference: string;
    parents: Array<{
      source: 'work_order' | 'billing_sheet';
      parentId: number;
      parentNumber: string;
      classification: 'standard' | 'emergency';
      oldLaborRate: string;
      newLaborRate: string;
      oldLaborSubtotal: string;
      newLaborSubtotal: string;
      oldTotalAmount: string;
      newTotalAmount: string;
    }>;
    skipped: Array<{
      source: 'work_order' | 'billing_sheet';
      parentId: number;
      reason: string;
    }>;
  }>;

  // Pricing audit events (Task #212) — read-only history of automatic
  // reprice actions, scoped per parent (billing sheet, work order, invoice).
  // When `companyId` is provided, results are additionally filtered to that
  // company so a manager from one company cannot read another company's events
  // even if the route-level scoping is bypassed.
  getPricingAuditEvents(
    source: 'billing_sheet' | 'work_order' | 'invoice',
    parentId: number,
    companyId?: number | null,
  ): Promise<PricingAuditEvent[]>;

  // Photo late-addition audit (Task #195) — records each photos-only PATCH
  // applied to a ticket that has already reached billing, so managers can
  // audit who added the late photo, when, and what state the ticket was in.
  recordPhotoLateAddition(input: InsertPhotoLateAddition): Promise<PhotoLateAddition>;
  getPhotoLateAdditions(
    ticketType: 'work_order' | 'billing_sheet',
    ticketId: number,
    companyId?: number | null,
  ): Promise<PhotoLateAddition[]>;

  // Manual Part Reviews
  getManualPartReviews(companyId: number): Promise<ManualPartReview[]>;
  getManualPartReview(id: number): Promise<ManualPartReview | undefined>;
  createManualPartReview(review: InsertManualPartReview): Promise<ManualPartReview>;
  approveManualPartReview(id: number, reviewedPrice: string): Promise<ManualPartReview | undefined>;

  // Parts Pending Approval
  getPendingParts(companyId: number): Promise<Part[]>;
  approvePart(id: number, price: string, cost?: string, companyId?: number): Promise<Part | undefined>;

  // AI Generation Logs
  createAiGenerationLog(log: InsertAiGenerationLog): Promise<AiGenerationLog>;

  // Company Profile Management
  getCompanyProfile(companyId: number): Promise<Company | undefined>;
  updateCompanyProfile(companyId: number, updates: Partial<InsertCompany>): Promise<Company>;

  // ── Wet Check System (Slice 2A) ───────────────────────────────────────────
  listIssueTypeConfigs(companyId: number): Promise<IssueTypeConfig[]>;
  listAllIssueTypeConfigs(companyId: number): Promise<IssueTypeConfig[]>;
  createIssueTypeConfig(companyId: number, data: Omit<InsertIssueTypeConfig, "companyId">): Promise<IssueTypeConfig>;
  updateIssueTypeConfig(companyId: number, id: number, patch: Partial<Omit<InsertIssueTypeConfig, "companyId">>): Promise<IssueTypeConfig | undefined>;
  reorderIssueTypeConfigs(companyId: number, orderedIds: number[]): Promise<IssueTypeConfig[]>;
  getPartsByIssueType(companyId: number, issueType: string, customerId?: number | null): Promise<{ parts: Part[]; recentPartIds: number[] }>;
  listPropertyControllers(companyId: number, customerId: number): Promise<PropertyController[]>;
  ensurePropertyControllers(
    companyId: number,
    customerId: number,
    count: number,
    branchName?: string | null,
  ): Promise<PropertyController[]>;
  updatePropertyController(
    companyId: number,
    customerId: number,
    letter: string,
    patch: { zoneCount?: number; notes?: string },
    branchName?: string | null,
  ): Promise<PropertyController | undefined>;
  upsertPropertyController(
    companyId: number,
    customerId: number,
    letter: string,
    values: { zoneCount: number; notes?: string },
    branchName?: string | null,
  ): Promise<PropertyController>;
  // Admin: company-wide overview of active customers and their controller
  // letters (with each controller's current zoneCount), grouped per
  // branch. The customer-level bucket (NULL branch) appears as
  // `branchName: null`. Excludes customers hidden from billing.
  listCustomerControllersOverview(companyId: number): Promise<Array<{
    customer: Customer;
    branches: Array<{ branchName: string | null; controllers: PropertyController[] }>;
  }>>;
  // Admin: reconcile property_controllers rows so they match `count` (1-26).
  // Updates customers.totalControllers as well (only when branchName is null,
  // i.e. customer-level edits). When shrinking, refuses to delete controllers
  // whose zoneCount > 0 unless `confirmDeleteWithZones` is true. Scoped to
  // the given branch (NULL == customer-level / "no branch"). Returns the
  // updated controller list for that branch and the new customer record.
  setCustomerControllerCount(
    companyId: number,
    customerId: number,
    count: number,
    opts?: { confirmDeleteWithZones?: boolean; branchName?: string | null },
  ): Promise<{ customer: Customer; controllers: PropertyController[]; removedLetters: string[] }>;

  listWetChecks(companyId: number, opts?: { status?: string; technicianId?: number }): Promise<WetCheck[]>;
  // Admin-only company-wide list with per-row aggregate counts (zone
  // records, findings, photos). Used by the company-admin Wet Checks
  // management page.
  listWetChecksForAdmin(companyId: number, opts?: { status?: string }): Promise<Array<WetCheck & {
    zoneRecordCount: number;
    findingCount: number;
    photoCount: number;
  }>>;
  // Hard-deletes a wet check and all of its child rows (zone records,
  // findings, photos), plus any downstream records produced from its
  // findings (billing sheets, estimates, work orders, and their items).
  // Refuses with WetCheckHasInvoicedRecordsError if any of those
  // downstream records is already attached to an invoice.
  deleteWetCheck(id: number, companyId: number): Promise<boolean>;

  listWetChecksPendingReview(companyId: number): Promise<Array<WetCheck & {
    findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
    totalBillable: string;
    customerLaborRate: string;
    autoBilledCount: number;
    autoBilledTotal: string;
    pendingCount: number;
    pendingTotal: string;
  }>>;
  // Cheap status lookup used by the route layer to choose role policy
  // for a finding edit (tech vs manager) without a full join.
  getWetCheckStatusForFinding(findingId: number, companyId: number): Promise<string | null>;
  // Canonical estimate-creation service shared by POST /api/estimates
  // and the wet-check conversion engine.
  createEstimateFromPayload(
    payload: EstimatePayloadInput,
    executor?: DbExecutor,
    explicitEstimateNumber?: string,
  ): Promise<EstimateWithItems>;
  getWetCheck(id: number, companyId: number): Promise<WetCheckWithDetails | undefined>;
  findActiveWetCheck(companyId: number, customerId: number, technicianId: number): Promise<WetCheck | undefined>;
  createWetCheck(insert: InsertWetCheck): Promise<WetCheck>;
  updateWetCheck(id: number, companyId: number, patch: Partial<InsertWetCheck>): Promise<WetCheck | undefined>;
  submitWetCheck(id: number, companyId: number): Promise<{
    wetCheck: WetCheck;
    billingSheetId: number | null;
    autoBilledCount: number;
    pendingCount: number;
  } | undefined>;
  // Dry-run pricing preview for the submit-confirm modal. Computes the
  // exact same totals the auto-bill path would persist, without writes.
  // `autoBillEnabled` reflects WET_CHECK_AUTO_BILL so the UI can gate.
  previewWetCheckSubmit(id: number, companyId: number): Promise<{
    autoBillEnabled: boolean;
    autoBilledCount: number;
    autoBilledPartsTotal: string;
    autoBilledLaborTotal: string;
    autoBilledGrandTotal: string;
    pendingCount: number;
    pendingByGroup: { quick_fix: number; advanced: number; zone_issue: number };
  } | undefined>;

  upsertWetCheckZoneRecord(
    wetCheckId: number,
    companyId: number,
    insert: InsertWetCheckZoneRecord,
  ): Promise<WetCheckZoneRecord>;
  updateWetCheckZoneRecord(
    id: number,
    companyId: number,
    patch: Partial<InsertWetCheckZoneRecord>,
  ): Promise<WetCheckZoneRecord | undefined>;

  createWetCheckFinding(
    zoneRecordId: number,
    companyId: number,
    insert: Omit<InsertWetCheckFinding, "zoneRecordId" | "wetCheckId" | "issueGroup">,
  ): Promise<WetCheckFinding>;
  updateWetCheckFinding(
    id: number,
    companyId: number,
    patch: Partial<InsertWetCheckFinding>,
  ): Promise<WetCheckFinding | undefined>;
  deleteWetCheckFinding(id: number, companyId: number): Promise<boolean>;

  approveWetCheck(
    id: number,
    companyId: number,
    manager: { id: number; name: string },
  ): Promise<WetCheck | undefined>;
  routeWetCheckFinding(
    id: number,
    companyId: number,
    resolution: "pending" | "repaired_in_field" | "sent_to_estimate" | "deferred_to_work_order" | "documented_only",
    manager: { id: number; name: string },
  ): Promise<WetCheckFinding | undefined>;
  convertWetCheck(
    id: number,
    companyId: number,
    manager: { id: number; name: string },
    scheduledDates?: Record<number, string | null>,
  ): Promise<{
    wetCheck: WetCheck;
    billingSheetId: number | null;
    estimateId: number | null;
    workOrderId: number | null;
  }>;

  attachWetCheckPhoto(
    wetCheckId: number,
    companyId: number,
    insert: Omit<InsertWetCheckPhoto, "wetCheckId">,
  ): Promise<WetCheckPhoto>;
  deleteWetCheckPhoto(id: number, companyId: number): Promise<boolean>;
  linkWetCheckPhotoToFinding(
    photoId: number,
    findingId: number,
    companyId: number,
  ): Promise<WetCheckPhoto | undefined>;
}

export class DatabaseStorage implements IStorage {
  private _billingCounterTableReady = false;
  private _billingCounterPrefixSeeded = new Set<string>();

  constructor() {
    // Database initialization - schema is managed by Drizzle
    this.initializeUsers();
    this.repairDivergedBillingSheets();
  }

  // Startup migration (BS-2026-0023): repair uninvoiced billing sheets where partsSubtotal
  // does not match the sum of their billing_sheet_items.totalPrice rows.
  // Uses app_settings as a one-time-run marker so it only performs a full scan once.
  // After initial repair the migration logs a completion marker; subsequent boots skip it.
  private async repairDivergedBillingSheets(): Promise<void> {
    const MIGRATION_KEY = 'repair-diverged-billing-sheets-v1';
    try {
      // Ensure app_settings exists before querying it (it may not yet exist if storage
      // is instantiated before server/index.ts runs its own CREATE TABLE IF NOT EXISTS)
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Check if this migration has already run successfully
      const existingMarker = await db.execute(
        sql`SELECT value FROM app_settings WHERE key = ${MIGRATION_KEY}`
      );
      if (existingMarker.rows.length > 0 && existingMarker.rows[0].value === 'completed') {
        console.log(`[MIGRATION] '${MIGRATION_KEY}': already completed, skipping`);
        return;
      }

      // Fetch all uninvoiced billing sheets (invoiceId is null and status != 'billed')
      const uninvoicedSheets = await db
        .select()
        .from(billingSheets)
        .where(and(isNull(billingSheets.invoiceId), sql`${billingSheets.status} != 'billed'`));

      let repairedCount = 0;
      for (const sheet of uninvoicedSheets) {
        const items = await db
          .select()
          .from(billingSheetItems)
          .where(eq(billingSheetItems.billingSheetId, sheet.id));

        // Sum the stored totalPrice column (not recomputing from qty * price) as required by spec
        const truePartsTotal = items.reduce(
          (sum, item) => sum + parseFloat(String(item.totalPrice || 0)),
          0
        );
        const recordedPartsTotal = parseFloat(String(sheet.partsSubtotal || 0));

        if (Math.abs(truePartsTotal - recordedPartsTotal) > 0.01) {
          const laborSubtotal = parseFloat(String(sheet.laborSubtotal || 0));
          const newTotalAmount = laborSubtotal + truePartsTotal;
          await db
            .update(billingSheets)
            .set({
              partsSubtotal: truePartsTotal.toFixed(2),
              totalAmount: newTotalAmount.toFixed(2),
            })
            .where(eq(billingSheets.id, sheet.id));

          console.log(
            `[MIGRATION] repaired billing sheet ${sheet.billingNumber} (id=${sheet.id}): ` +
            `partsSubtotal ${recordedPartsTotal.toFixed(2)} → ${truePartsTotal.toFixed(2)}, ` +
            `totalAmount ${parseFloat(String(sheet.totalAmount || 0)).toFixed(2)} → ${newTotalAmount.toFixed(2)}`
          );
          repairedCount++;
        }
      }

      if (repairedCount > 0) {
        console.log(`[MIGRATION] '${MIGRATION_KEY}': repaired ${repairedCount} billing sheet(s).`);
      } else {
        console.log(`[MIGRATION] '${MIGRATION_KEY}': no diverged billing sheets found.`);
      }

      // Mark this migration as completed so it is skipped on future boots
      await db.execute(
        sql`INSERT INTO app_settings (key, value) VALUES (${MIGRATION_KEY}, 'completed')
            ON CONFLICT (key) DO UPDATE SET value = 'completed'`
      );
    } catch (err) {
      console.error(`[MIGRATION] '${MIGRATION_KEY}' failed:`, err);
    }
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

  // Users - with optional pagination (backward compatible)
  async getUsers(companyId?: number, options?: { limit?: number; offset?: number }): Promise<User[]> {
    const conditions = [];
    if (companyId !== undefined && companyId !== null) {
      conditions.push(eq(users.companyId, companyId));
    }

    let query = conditions.length > 0
      ? db.select().from(users).where(and(...conditions))
      : db.select().from(users);

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
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
    const words = query.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return await db.select().from(parts);
    }
    const conditions = words.map(word =>
      or(
        ilike(parts.name, `%${word}%`),
        ilike(parts.description, `%${word}%`),
        ilike(parts.sku, `%${word}%`)
      )
    );
    return await db.select().from(parts).where(and(...conditions));
  }

  async createPart(part: InsertPart): Promise<Part> {
    const serialized: DrizzlePartInsert = {
      ...toDrizzleInsert<DrizzlePartInsert>(part),
      price: Number(part.price).toFixed(2),
      cost: part.cost != null ? Number(part.cost).toFixed(2) : null,
    };
    const [newPart] = await db.insert(parts).values(serialized).returning();
    return newPart;
  }

  async updatePart(id: number, part: Partial<InsertPart>): Promise<Part | undefined> {
    try {
      const [updatedPart] = await db.update(parts).set(toDrizzleInsert<Partial<DrizzlePartInsert>>(part)).where(eq(parts.id, id)).returning();
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
        
        totalPrice += partPrice * quantity;
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
          
          totalPrice += partPrice * quantity;
        }
      }

      Object.assign(assembly, {
        totalPrice: totalPrice.toFixed(2),
        totalLaborHours: totalLaborHours.toFixed(2)
      });

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
        const items = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimate.id));
        
        let partsSubtotal = 0;
        let totalLaborHours = 0;
        
        items.forEach(item => {
          const itemTotal = parseFloat(String(item.totalPrice));
          const itemLaborHours = parseFloat(String(item.laborHours));
          partsSubtotal += itemTotal;
          totalLaborHours += itemLaborHours;
        });
        
        // Prefer the SNAPSHOT appliedLaborRate (locked at creation /
        // conversion) over the mutable customer/estimate laborRate so
        // downstream reads never reprice an estimate if rates change later.
        const laborRate = parseFloat(String(estimate.appliedLaborRate ?? estimate.laborRate));

        const laborSubtotal = totalLaborHours * laborRate;
        const totalAmount = partsSubtotal + laborSubtotal;

        return {
          ...estimate,
          partsSubtotal: partsSubtotal.toFixed(2),
          laborSubtotal: laborSubtotal.toFixed(2),
          totalAmount: totalAmount.toFixed(2)
        };
      })
    );
    
    return estimatesWithCalculatedTotals;
  }

  // Manager review queue. Mirrors getEstimates per-row recompute, but
  // filters to estimates whose internal review track is still
  // `pending_approval`. When `companyId` is non-null (the normal case for
  // billing_manager / company_admin), restricts to that company. `null`
  // is reserved for super_admin global access.
  async getEstimatesPendingApproval(companyId: number | null): Promise<Estimate[]> {
    const whereClause = companyId === null
      ? eq(estimates.internalStatus, "pending_approval")
      : and(eq(estimates.internalStatus, "pending_approval"), eq(estimates.companyId, companyId));
    const estimatesList = await db
      .select()
      .from(estimates)
      .where(whereClause as any)
      .orderBy(desc(estimates.createdAt));

    const estimatesWithCalculatedTotals = await Promise.all(
      estimatesList.map(async (estimate) => {
        const items = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimate.id));

        let partsSubtotal = 0;
        let totalLaborHours = 0;
        items.forEach(item => {
          partsSubtotal += parseFloat(String(item.totalPrice));
          totalLaborHours += parseFloat(String(item.laborHours));
        });

        const laborRate = parseFloat(String(estimate.appliedLaborRate ?? estimate.laborRate));
        const laborSubtotal = totalLaborHours * laborRate;
        const totalAmount = partsSubtotal + laborSubtotal;

        return {
          ...estimate,
          partsSubtotal: partsSubtotal.toFixed(2),
          laborSubtotal: laborSubtotal.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
        };
      })
    );

    return estimatesWithCalculatedTotals;
  }

  async getEstimate(id: number): Promise<EstimateWithItems | undefined> {
    const [estimate] = await db.select().from(estimates).where(eq(estimates.id, id));
    if (!estimate) return undefined;

    const items = await db.select().from(estimateItems).where(eq(estimateItems.estimateId, id)).orderBy(estimateItems.sortOrder);

    // Recalculate totals to ensure accuracy
    let partsSubtotal = 0;
    let totalLaborHours = 0;

    items.forEach(item => {
      const itemTotal = parseFloat(String(item.totalPrice));
      const itemLaborHours = parseFloat(String(item.laborHours));
      partsSubtotal += itemTotal;
      totalLaborHours += itemLaborHours;
    });

    // Prefer SNAPSHOT appliedLaborRate so a converted estimate cannot be
    // repriced after customer/estimate laborRate changes downstream.
    const laborRate = parseFloat(String(estimate.appliedLaborRate ?? estimate.laborRate));
    const laborSubtotal = totalLaborHours * laborRate;
    const totalAmount = partsSubtotal + laborSubtotal;

    return {
      ...estimate,
      partsSubtotal: partsSubtotal.toFixed(2),
      laborSubtotal: laborSubtotal.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      items,
    };
  }

  // Single sanctioned write path for an estimate + its items. Both the
  // public createEstimate (with its own tx) and the wet-check conversion
  // engine (which runs inside its own tx) call this so they share insert
  // ordering, snapshot semantics, and any future side effects.
  async _writeEstimateWithItems(
    executor: DbExecutor,
    estimate: InsertEstimate,
    items: InsertEstimateItem[],
    explicitEstimateNumber?: string,
  ): Promise<EstimateWithItems> {
    const estimateNumber = explicitEstimateNumber
      ?? (estimate as { estimateNumber?: string }).estimateNumber
      ?? `EST-${Date.now()}`;
    const [newEstimate] = await executor
      .insert(estimates)
      .values([{ ...estimate, estimateNumber }])
      .returning();
    const createdItems: EstimateItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const [createdItem] = await executor.insert(estimateItems).values({
        ...item,
        estimateId: newEstimate.id,
        sortOrder: item.sortOrder ?? i,
      }).returning();
      createdItems.push(createdItem);
    }
    return { ...newEstimate, items: createdItems };
  }

  async createEstimate(estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<EstimateWithItems> {
    return await db.transaction(async (tx) => this._writeEstimateWithItems(tx, estimate, items));
  }

  // Canonical estimate-creation service. Identical to what POST
  // /api/estimates does (parse → processEstimatePayload → write items),
  // exposed as a single entry point so callers — the route handler AND
  // the wet-check conversion engine — go through the same code path.
  // When `executor` is provided, the writes happen inside the caller's
  // transaction (used by convertWetCheck to keep BS+est+WO atomic);
  // otherwise the helper opens its own tx via createEstimate.
  async createEstimateFromPayload(
    payload: EstimatePayloadInput,
    executor?: DbExecutor,
    explicitEstimateNumber?: string,
  ): Promise<EstimateWithItems> {
    const { estimate, items } = processEstimatePayload(payload);
    if (executor) {
      return this._writeEstimateWithItems(executor, estimate, items, explicitEstimateNumber);
    }
    if (explicitEstimateNumber) {
      return await db.transaction(async (tx) =>
        this._writeEstimateWithItems(tx, estimate, items, explicitEstimateNumber));
    }
    return this.createEstimate(estimate, items);
  }

  async updateEstimate(id: number, estimate: Partial<InsertEstimate>): Promise<Estimate | undefined> {
    const [updatedEstimate] = await db.update(estimates).set(estimate).where(eq(estimates.id, id)).returning();
    return updatedEstimate || undefined;
  }

  async updateEstimateWithItems(id: number, estimate: InsertEstimate, items: InsertEstimateItem[]): Promise<EstimateWithItems> {
    return await db.transaction(async (tx) => {
      const [updatedEstimate] = await tx.update(estimates).set(estimate).where(eq(estimates.id, id)).returning();
      if (!updatedEstimate) {
        throw new Error(`Estimate ${id} not found`);
      }
      await tx.delete(estimateItems).where(eq(estimateItems.estimateId, id));
      const createdItems: EstimateItem[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const [createdItem] = await tx.insert(estimateItems).values({
          ...item,
          estimateId: id,
          sortOrder: item.sortOrder ?? i,
        }).returning();
        createdItems.push(createdItem);
      }
      return { ...updatedEstimate, items: createdItems };
    });
  }

  async deleteEstimate(id: number): Promise<boolean> {
    const result = await db.delete(estimates).where(eq(estimates.id, id));
    return (result.rowCount || 0) > 0;
  }

  async getEstimateItems(estimateId: number): Promise<EstimateItem[]> {
    return await db.select().from(estimateItems).where(eq(estimateItems.estimateId, estimateId)).orderBy(estimateItems.sortOrder);
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
      assigned: number;
      pendingManagerReview: number;
      total: number;
    };
    billingSheetStats: {
      pendingManagerReview: number;
    };
    recentWorkOrders: WorkOrder[];
  }> {
    const allEstimates = await db.select().from(estimates);
    const allParts = await db.select().from(parts);
    const allEstimateItems = await db.select().from(estimateItems);
    const allWorkOrders = await db.select().from(workOrders);
    const allBillingSheets = await db.select().from(billingSheets);

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
      completed: allWorkOrders.filter(wo => wo.status === "work_completed").length,
      assigned: allWorkOrders.filter(wo => wo.status === "assigned").length,
      pendingManagerReview: allWorkOrders.filter(wo => wo.status === "pending_manager_review" || wo.status === "work_completed").length,
      total: allWorkOrders.length
    };

    // Billing sheet stats
    const billingSheetStats = {
      pendingManagerReview: allBillingSheets.filter(bs =>
        bs.status === "pending_manager_review" || bs.status === "submitted" || bs.status === "completed"
      ).length,
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
      billingSheetStats,
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

  async saveQuickBooksIntegration(data: {
    companyId: string;
    accessToken: string;
    refreshToken: string;
    realmId: string;
    expiresAt: Date;
    lastRefreshAttempt?: Date | null;
    lastRefreshSuccess?: Date | null;
    lastRefreshFailure?: Date | null;
    connectionStatus?: string;
    reconnectRequiredReason?: string | null;
    tokenEnvironment?: string;
  }): Promise<void> {
    try {
      const tokenEnvironment = data.tokenEnvironment ?? (process.env.NODE_ENV === 'production' ? 'production' : 'sandbox');
      await db.insert(quickbooksIntegration).values({
        companyId: data.companyId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        realmId: data.realmId,
        expiresAt: data.expiresAt,
        lastRefreshAttempt: data.lastRefreshAttempt ?? null,
        lastRefreshSuccess: data.lastRefreshSuccess ?? null,
        lastRefreshFailure: data.lastRefreshFailure ?? null,
        connectionStatus: data.connectionStatus ?? 'connected',
        reconnectRequiredReason: data.reconnectRequiredReason ?? null,
        tokenEnvironment,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: quickbooksIntegration.realmId,
        set: {
          companyId: data.companyId,
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: data.expiresAt,
          lastRefreshAttempt: data.lastRefreshAttempt ?? null,
          lastRefreshSuccess: data.lastRefreshSuccess ?? null,
          lastRefreshFailure: data.lastRefreshFailure ?? null,
          connectionStatus: data.connectionStatus ?? 'connected',
          reconnectRequiredReason: data.reconnectRequiredReason ?? null,
          tokenEnvironment,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Error saving QuickBooks integration:', error);
      throw error;
    }
  }

  async getQuickBooksIntegration(realmId: string): Promise<(typeof quickbooksIntegration.$inferSelect) | null> {
    try {
      const result = await db.select().from(quickbooksIntegration)
        .where(eq(quickbooksIntegration.realmId, realmId))
        .limit(1);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting QuickBooks integration:', error);
      return null;
    }
  }

  async getQuickBooksIntegrationByCompanyId(companyId: string): Promise<(typeof quickbooksIntegration.$inferSelect) | null> {
    try {
      const result = await db.select().from(quickbooksIntegration)
        .where(eq(quickbooksIntegration.companyId, companyId))
        .limit(1);
      return result.length > 0 ? result[0] : null;
    } catch (error) {
      console.error('Error getting QuickBooks integration by companyId:', error);
      return null;
    }
  }

  async markQuickBooksReconnectRequired(realmId: string, reason: string): Promise<void> {
    try {
      await db.update(quickbooksIntegration)
        .set({
          connectionStatus: 'reconnect_required',
          reconnectRequiredReason: reason,
          lastRefreshFailure: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(quickbooksIntegration.realmId, realmId));
    } catch (error) {
      console.error('Error marking QuickBooks reconnect required:', error);
      throw error;
    }
  }

  async getQuickBooksAllIntegrations(): Promise<(typeof quickbooksIntegration.$inferSelect)[]> {
    try {
      return await db.select().from(quickbooksIntegration).orderBy(quickbooksIntegration.realmId);
    } catch (error) {
      console.error('Error getting all QuickBooks integrations:', error);
      return [];
    }
  }

  async getAllActiveQuickBooksIntegrations(): Promise<(typeof quickbooksIntegration.$inferSelect)[]> {
    try {
      return await db.select().from(quickbooksIntegration)
        .where(eq(quickbooksIntegration.connectionStatus, 'connected'));
    } catch (error) {
      console.error('Error fetching all active QuickBooks integrations:', error);
      return [];
    }
  }

  async getQuickBooksCustomerStatus(companyId?: string | null): Promise<{ isConnected: boolean; companyName?: string; lastSync?: string; customerCount?: number; connectionStatus?: string; reconnectRequiredReason?: string | null; companyId?: string | null; realmId?: string | null }> {
    // Check if QuickBooks integration exists for this company
    let integration: (typeof quickbooksIntegration.$inferSelect)[];
    if (companyId) {
      integration = await db.select().from(quickbooksIntegration).where(eq(quickbooksIntegration.companyId, companyId)).limit(1);
      // Fall back to first integration (handles legacy data where companyId was stored as QB realm ID)
      if (integration.length === 0) {
        integration = await db.select().from(quickbooksIntegration).limit(1);
      }
    } else {
      integration = await db.select().from(quickbooksIntegration).limit(1);
    }
    
    const allCustomers = await db.select().from(customers);
    
    if (integration.length === 0) {
      return {
        isConnected: false,
        companyName: undefined,
        lastSync: undefined,
        customerCount: allCustomers.length,
        connectionStatus: 'disconnected',
        reconnectRequiredReason: null,
        companyId: null,
        realmId: null
      };
    }
    
    const qbIntegration = integration[0];
    const isTokenValid = qbIntegration.expiresAt > new Date();
    const isReconnectRequired = qbIntegration.connectionStatus === 'reconnect_required';
    
    return {
      isConnected: isTokenValid && !isReconnectRequired,
      companyName: qbIntegration.companyId,
      lastSync: qbIntegration.updatedAt?.toISOString() || new Date().toISOString(),
      customerCount: allCustomers.length,
      connectionStatus: qbIntegration.connectionStatus,
      reconnectRequiredReason: qbIntegration.reconnectRequiredReason,
      companyId: qbIntegration.companyId,
      realmId: qbIntegration.realmId
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
          email: qbCustomer.email || '',
          phone: qbCustomer.phone,
          address: qbCustomer.address,
          companyId: 1,
          laborRate: "45.00",
          paymentTerms: "net_30",
          notes: `Synced from QuickBooks (ID: ${qbCustomer.id})`
        } as InsertCustomer);
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

  async disconnectQuickBooks(companyId: string): Promise<void> {
    await db.delete(quickbooksIntegration).where(eq(quickbooksIntegration.companyId, companyId));
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

  // Shared writer for createWorkOrder and convertWetCheck's deferred path.
  // Accepts an executor so callers can run inside a tx.
  async _writeWorkOrderWithItems(
    executor: DbExecutor,
    workOrder: typeof workOrders.$inferInsert,
    items: Array<{
      partId?: number | null;
      partName: string;
      partPrice: string;
      quantity: number;
      laborHours: string;
      totalPrice: string;
    }>,
  ): Promise<WorkOrder> {
    const [newWorkOrder] = await executor.insert(workOrders).values([workOrder]).returning();
    for (const item of items) {
      await executor.insert(workOrderItems).values([{
        workOrderId: newWorkOrder.id,
        partId: item.partId ?? null,
        partName: item.partName,
        partPrice: item.partPrice,
        quantity: item.quantity,
        laborHours: item.laborHours,
        totalPrice: item.totalPrice,
      }]);
    }
    return newWorkOrder;
  }

  async createWorkOrder(workOrder: InsertWorkOrder, estimateItemsList?: EstimateItem[]): Promise<WorkOrder> {
    const workOrderNumber = `WO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return this._writeWorkOrderWithItems(
      db,
      { ...workOrder, workOrderNumber } as typeof workOrders.$inferInsert,
      (estimateItemsList ?? []).map(item => ({
        partId: item.partId,
        partName: item.partName,
        partPrice: item.partPrice,
        quantity: item.quantity,
        laborHours: item.laborHours,
        totalPrice: item.totalPrice,
      })),
    );
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
    
    // Create the work order with full pricing snapshot from estimate
    const workOrderData: InsertWorkOrder & { workOrderNumber: string } = {
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
      // Pricing snapshot from estimate
      laborRate: estimate.laborRate,
      laborSubtotal: estimate.laborSubtotal,
      partsSubtotal: estimate.partsSubtotal,
      estimatedTotal: estimate.totalAmount, // Original estimate total for comparison
      totalAmount: estimate.totalAmount,
      totalItems: estimate.items?.length || 0,
    };

    const [newWorkOrder] = await db.insert(workOrders).values(toDrizzleInsert<DrizzleWorkOrderInsert>(workOrderData)).returning();

    if (estimate.items) {
      for (const item of estimate.items) {
        await db.insert(workOrderItems).values({
          workOrderId: newWorkOrder.id,
          partId: item.partId,
          partName: item.partName,
          partPrice: item.partPrice,
          quantity: item.quantity,
          laborHours: item.laborHours,
          totalPrice: item.totalPrice,
        });
      }
    }

    // Update estimate with work order reference and mark as converted
    await db.update(estimates)
      .set({ 
        status: 'approved', // Keep as approved, don't change status
        workOrderId: newWorkOrder.id 
      })
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

  async hasInvoiceItems(workOrderId: number): Promise<boolean> {
    const rows = await db.select({ id: invoiceItems.id }).from(invoiceItems).where(eq(invoiceItems.workOrderId, workOrderId)).limit(1);
    return rows.length > 0;
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

  async markWorkOrderNoPhotosNeeded(workOrderId: number, userId: number): Promise<WorkOrder | undefined> {
    const [updated] = await db.update(workOrders)
      .set({
        noPhotosNeeded: true,
        noPhotosNeededBy: userId,
        noPhotosNeededAt: new Date(),
      })
      .where(eq(workOrders.id, workOrderId))
      .returning();
    return updated || undefined;
  }

  async clearWorkOrderNoPhotosNeeded(workOrderId: number): Promise<WorkOrder | undefined> {
    const [updated] = await db.update(workOrders)
      .set({
        noPhotosNeeded: false,
        noPhotosNeededBy: null,
        noPhotosNeededAt: null,
      })
      .where(eq(workOrders.id, workOrderId))
      .returning();
    return updated || undefined;
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

  async deleteWorkOrderItems(workOrderId: number): Promise<boolean> {
    await db.delete(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));
    return true;
  }

  async replaceWorkOrderItemsInTransaction(workOrderId: number, items: InsertWorkOrderItem[]): Promise<WorkOrderItem[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));
      if (items.length === 0) return [];
      const inserted = await tx.insert(workOrderItems).values(items).returning();
      return inserted;
    });
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

  async getNextBillingNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `BS-${year}-`;

    if (!this._billingCounterTableReady) {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS billing_number_counters (
          prefix TEXT PRIMARY KEY,
          last_seq INTEGER NOT NULL DEFAULT 0
        )
      `);
      this._billingCounterTableReady = true;
    }

    if (!this._billingCounterPrefixSeeded.has(prefix)) {
      const likePattern = `${prefix}%`;
      await db.execute(sql`
        INSERT INTO billing_number_counters (prefix, last_seq)
        VALUES (${prefix}, COALESCE(
          (SELECT MAX(CAST(SUBSTRING(billing_number FROM '[0-9]+$') AS INTEGER))
            FROM billing_sheets WHERE billing_number LIKE ${likePattern}), 0))
        ON CONFLICT (prefix) DO NOTHING
      `);
      this._billingCounterPrefixSeeded.add(prefix);
    }

    const result = await db.execute(sql`
      UPDATE billing_number_counters
      SET last_seq = last_seq + 1
      WHERE prefix = ${prefix}
      RETURNING last_seq
    `);
    const seq = Number(result.rows[0].last_seq);
    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  async createBillingSheet(billingSheetData: InsertBillingSheet & { items?: InsertBillingSheetItem[] }): Promise<BillingSheet> {
    // Extract items from the data
    const { items, ...sheetData } = billingSheetData;
    
    // Calculate totals if they're missing
    let laborSubtotal = Number(sheetData.laborSubtotal || 0);
    let partsSubtotal = Number(sheetData.partsSubtotal || 0);
    let totalAmount = Number(sheetData.totalAmount || 0);

    // If we have items, calculate the totals
    if (items && Array.isArray(items)) {
      partsSubtotal = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitPrice)), 0);
      laborSubtotal = Number(sheetData.totalHours || 0) * Number(sheetData.laborRate || 0);
      totalAmount = laborSubtotal + partsSubtotal;
    }

    const finalSheetData = {
      ...sheetData,
      laborSubtotal: laborSubtotal.toString(),
      partsSubtotal: partsSubtotal.toString(),
      totalAmount: totalAmount.toString(),
      workDate: sheetData.workDate ? (sheetData.workDate instanceof Date ? sheetData.workDate : new Date(sheetData.workDate)) : new Date()
    };

    console.log('Creating billing sheet with data:', finalSheetData);

    const MAX_RETRIES = 3;
    let newSheet: BillingSheet | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const billingNumber = await this.getNextBillingNumber();

      const finalSheetDataWithNumber = {
        ...finalSheetData,
        billingNumber
      };

      const { createdAt, updatedAt, ...insertData } = finalSheetDataWithNumber as Record<string, unknown>;

      try {
        const [inserted] = await db.insert(billingSheets).values([toDrizzleInsert<DrizzleBillingSheetInsert>(insertData)]).returning();
        newSheet = inserted;
        break;
      } catch (err: unknown) {
        const errObj = err as Record<string, unknown> | null | undefined;
        const code = typeof errObj?.code === 'string' ? errObj.code : '';
        const message = typeof errObj?.message === 'string' ? errObj.message : '';
        const isUniqueViolation = code === '23505' || message.includes('unique');
        if (isUniqueViolation && attempt < MAX_RETRIES) {
          console.warn(`[billing] Billing number collision on attempt ${attempt} (${billingNumber}), retrying...`);
          continue;
        }
        throw err;
      }
    }

    if (!newSheet) {
      throw new Error('Failed to create billing sheet after max retries');
    }
    
    // If items are provided, insert them and then re-derive partsSubtotal from the persisted rows
    if (items && Array.isArray(items)) {
      let insertedItems: typeof billingSheetItems.$inferSelect[] = [];
      if (items.length > 0) {
        const values = items.map(item => ({
          ...item,
          billingSheetId: newSheet.id,
          totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString(),
        }));
        insertedItems = await db.insert(billingSheetItems).values(values).returning();
      }

      // Derive partsSubtotal from what was actually written — not from request data
      const truePartsSubtotal = insertedItems.reduce(
        (sum, row) => sum + parseFloat(String(row.totalPrice || 0)),
        0
      );
      const trueLaborSubtotal = parseFloat(String(newSheet.laborSubtotal || 0));
      const trueTotalAmount = trueLaborSubtotal + truePartsSubtotal;

      const [correctedSheet] = await db
        .update(billingSheets)
        .set({
          partsSubtotal: truePartsSubtotal.toFixed(2),
          totalAmount: trueTotalAmount.toFixed(2),
        })
        .where(eq(billingSheets.id, newSheet.id))
        .returning();

      console.log(
        `[AUDIT] billing_sheet_created_partsSubtotal_verified billingSheetId=${newSheet.id} ` +
        `partsSubtotal=${truePartsSubtotal.toFixed(2)} totalAmount=${trueTotalAmount.toFixed(2)}`
      );
      return correctedSheet;
    }
    
    return newSheet;
  }

  async updateBillingSheet(id: number, billingSheetData: Partial<InsertBillingSheet>): Promise<BillingSheet | undefined> {
    const [updatedSheet] = await db.update(billingSheets).set(billingSheetData).where(eq(billingSheets.id, id)).returning();
    return updatedSheet || undefined;
  }

  async markBillingSheetNoPhotosNeeded(sheetId: number, userId: number): Promise<BillingSheet | undefined> {
    const [updated] = await db.update(billingSheets)
      .set({
        noPhotosNeeded: true,
        noPhotosNeededBy: userId,
        noPhotosNeededAt: new Date(),
      })
      .where(eq(billingSheets.id, sheetId))
      .returning();
    return updated || undefined;
  }

  async deleteBillingSheet(id: number): Promise<boolean> {
    // Refuse to delete a sheet that has already been pushed onto an
    // invoice. Two ways a sheet can be "on an invoice":
    //   1. billing_sheets.invoiceId is set (legacy single-invoice link), or
    //   2. one or more invoice_items rows reference it (the current model).
    // Either case would either orphan the invoice line items or strand
    // the customer's invoice without a source-of-truth, so we surface a
    // typed error that the route layer maps to a 409 with a friendly
    // message instead of letting Postgres throw a FK violation.
    const [sheet] = await db.select().from(billingSheets).where(eq(billingSheets.id, id));
    if (!sheet) return false;
    if (sheet.invoiceId != null) {
      const [inv] = await db.select({ invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(eq(invoices.id, sheet.invoiceId));
      throw new BillingSheetInvoicedError(sheet.invoiceId, inv?.invoiceNumber ?? null);
    }
    const linkedItems = await db.select({
      id: invoiceItems.id,
      invoiceId: invoiceItems.invoiceId,
    }).from(invoiceItems).where(eq(invoiceItems.billingSheetId, id)).limit(1);
    if (linkedItems.length > 0) {
      const linkedInvoiceId = linkedItems[0].invoiceId ?? null;
      let invoiceNumber: string | null = null;
      if (linkedInvoiceId != null) {
        const [inv] = await db.select({ invoiceNumber: invoices.invoiceNumber })
          .from(invoices)
          .where(eq(invoices.id, linkedInvoiceId));
        invoiceNumber = inv?.invoiceNumber ?? null;
      }
      throw new BillingSheetInvoicedError(linkedInvoiceId, invoiceNumber);
    }

    // Single transaction so a partial delete can't leave orphan rows
    // pointing at a billing_sheets row that no longer exists. Order:
    //   1. Null out wet_check_findings.billingSheetId (audit history is
    //      preserved on the finding; only the routing pointer is cleared).
    //   2. Delete manual_part_reviews (notNull FK; the review is per-sheet
    //      so it has no meaning once the sheet is gone, mirroring how
    //      billing_sheet_items get hard-deleted alongside the sheet).
    //   3. Delete billing_sheet_items (existing behavior).
    //   4. Delete the billing_sheets row.
    // pricing_audit_events references sheets by (source, parentId) without
    // a real FK, so it intentionally retains the audit trail after delete
    // — same as deleteWorkOrder leaves it untouched.
    return await db.transaction(async (tx) => {
      await tx.update(wetCheckFindings)
        .set({ billingSheetId: null })
        .where(eq(wetCheckFindings.billingSheetId, id));
      await tx.delete(manualPartReviews).where(eq(manualPartReviews.billingSheetId, id));
      await tx.delete(billingSheetItems).where(eq(billingSheetItems.billingSheetId, id));
      const result = await tx.delete(billingSheets).where(eq(billingSheets.id, id));
      return (result.rowCount || 0) > 0;
    });
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

  async replaceBillingSheetItemsInTransaction(billingSheetId: number, items: InsertBillingSheetItem[]): Promise<BillingSheetItem[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(billingSheetItems).where(eq(billingSheetItems.billingSheetId, billingSheetId));
      if (items.length === 0) return [];
      const values = items.map(item => ({
        ...item,
        billingSheetId,
        totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString(),
      }));
      const inserted = await tx.insert(billingSheetItems).values(values).returning();
      return inserted;
    });
  }

  // Atomically replaces billing sheet items AND resyncs partsSubtotal/totalAmount on the sheet record
  // within a single DB transaction — preventing any window where items and subtotals are out of sync.
  async replaceBillingSheetItemsAndResync(
    billingSheetId: number,
    items: InsertBillingSheetItem[]
  ): Promise<{ items: BillingSheetItem[]; partsSubtotal: string; totalAmount: string }> {
    return await db.transaction(async (tx) => {
      await tx.delete(billingSheetItems).where(eq(billingSheetItems.billingSheetId, billingSheetId));

      let inserted: typeof billingSheetItems.$inferSelect[] = [];
      if (items.length > 0) {
        const values = items.map(item => ({
          ...item,
          billingSheetId,
          totalPrice: (Number(item.quantity) * Number(item.unitPrice)).toString(),
        }));
        inserted = await tx.insert(billingSheetItems).values(values).returning();
      }

      // Derive partsSubtotal from the rows that were just persisted
      const truePartsSubtotal = inserted.reduce(
        (sum, row) => sum + parseFloat(String(row.totalPrice || 0)),
        0
      );

      // Read the current laborSubtotal from the sheet inside the same transaction
      const [currentSheet] = await tx
        .select({ laborSubtotal: billingSheets.laborSubtotal })
        .from(billingSheets)
        .where(eq(billingSheets.id, billingSheetId));
      const laborSubtotal = parseFloat(String(currentSheet?.laborSubtotal || 0));
      const trueTotalAmount = laborSubtotal + truePartsSubtotal;

      await tx
        .update(billingSheets)
        .set({
          partsSubtotal: truePartsSubtotal.toFixed(2),
          totalAmount: trueTotalAmount.toFixed(2),
        })
        .where(eq(billingSheets.id, billingSheetId));

      return {
        items: inserted,
        partsSubtotal: truePartsSubtotal.toFixed(2),
        totalAmount: trueTotalAmount.toFixed(2),
      };
    });
  }

  async getBillingSheetItems(billingSheetId: number): Promise<BillingSheetItem[]> {
    return await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, billingSheetId));
  }

  // ─── Catalog $0-price audit / backfill (Tasks #160 + #161) ─────────────────
  // Covers billing_sheet_items, work_order_items, AND invoice_items. A "bad"
  // row is any line item with a non-null partId whose stored unit price is 0
  // while the catalog row reports a price > 0. Scoping is by parts.company_id
  // (the catalog is the authoritative source of truth).
  async getZeroPriceCatalogItems(companyId: number | null) {
    const billingRows = await db.execute(sql`
      SELECT
        'billing_sheet'::text AS source,
        bsi.id              AS item_id,
        bsi.billing_sheet_id AS parent_id,
        bs.billing_number   AS parent_number,
        bs.customer_id      AS customer_id,
        bs.customer_name    AS customer_name,
        bs.work_date        AS work_date,
        bs.technician_name  AS technician_name,
        bs.status           AS status,
        bs.invoice_id       AS invoice_id,
        bsi.part_id         AS part_id,
        bsi.part_name       AS part_name,
        bsi.quantity        AS quantity,
        bsi.unit_price      AS stored_unit_price,
        bsi.total_price     AS stored_total_price,
        p.price             AS catalog_unit_price
      FROM billing_sheet_items bsi
      INNER JOIN parts p           ON p.id = bsi.part_id
      INNER JOIN billing_sheets bs ON bs.id = bsi.billing_sheet_id
      WHERE bsi.part_id IS NOT NULL
        AND CAST(bsi.unit_price AS DOUBLE PRECISION) = 0
        AND CAST(p.price AS DOUBLE PRECISION) > 0
        AND (${companyId}::int IS NULL OR p.company_id = ${companyId}::int)
    `);

    const workOrderRows = await db.execute(sql`
      SELECT
        'work_order'::text   AS source,
        woi.id               AS item_id,
        woi.work_order_id    AS parent_id,
        wo.work_order_number AS parent_number,
        wo.customer_id       AS customer_id,
        wo.customer_name     AS customer_name,
        wo.scheduled_date    AS work_date,
        wo.assigned_technician_name AS technician_name,
        wo.status            AS status,
        wo.invoice_id        AS invoice_id,
        woi.part_id          AS part_id,
        woi.part_name        AS part_name,
        woi.quantity         AS quantity,
        woi.part_price       AS stored_unit_price,
        woi.total_price      AS stored_total_price,
        p.price              AS catalog_unit_price
      FROM work_order_items woi
      INNER JOIN parts p        ON p.id = woi.part_id
      INNER JOIN work_orders wo ON wo.id = woi.work_order_id
      WHERE woi.part_id IS NOT NULL
        AND CAST(woi.part_price AS DOUBLE PRECISION) = 0
        AND CAST(p.price AS DOUBLE PRECISION) > 0
        AND (${companyId}::int IS NULL OR p.company_id = ${companyId}::int)
    `);

    const invoiceRows = await db.execute(sql`
      SELECT
        'invoice'::text       AS source,
        ii.id                 AS item_id,
        ii.invoice_id         AS parent_id,
        inv.invoice_number    AS parent_number,
        inv.customer_id       AS customer_id,
        inv.customer_name     AS customer_name,
        ii.work_date          AS work_date,
        ''::text              AS technician_name,
        inv.status            AS status,
        ii.invoice_id         AS invoice_id,
        ii.part_id            AS part_id,
        ii.part_name          AS part_name,
        ii.quantity           AS quantity,
        ii.unit_price         AS stored_unit_price,
        ii.total_price        AS stored_total_price,
        p.price               AS catalog_unit_price
      FROM invoice_items ii
      INNER JOIN parts p        ON p.id = ii.part_id
      INNER JOIN invoices inv   ON inv.id = ii.invoice_id
      WHERE ii.part_id IS NOT NULL
        AND CAST(ii.unit_price AS DOUBLE PRECISION) = 0
        AND CAST(p.price AS DOUBLE PRECISION) > 0
        AND (${companyId}::int IS NULL OR p.company_id = ${companyId}::int)
    `);

    const merged = [...billingRows.rows, ...workOrderRows.rows, ...invoiceRows.rows] as Array<Record<string, unknown>>;
    return merged
      .map((r) => {
        const quantity = parseFloat(String(r.quantity ?? 0));
        const catalogPrice = parseFloat(String(r.catalog_unit_price ?? 0));
        const storedTotal = parseFloat(String(r.stored_total_price ?? 0));
        const expectedTotal = quantity * catalogPrice;
        const workDate = r.work_date
          ? (r.work_date instanceof Date ? r.work_date : new Date(String(r.work_date)))
          : null;
        return {
          source: r.source as 'billing_sheet' | 'work_order' | 'invoice',
          itemId: Number(r.item_id),
          parentId: Number(r.parent_id),
          parentNumber: String(r.parent_number ?? ''),
          customerId: r.customer_id == null ? null : Number(r.customer_id),
          customerName: String(r.customer_name ?? ''),
          workDate,
          technicianName: String(r.technician_name ?? ''),
          status: String(r.status ?? ''),
          invoiceId: r.invoice_id == null ? null : Number(r.invoice_id),
          partId: Number(r.part_id),
          partName: String(r.part_name ?? ''),
          quantity: String(r.quantity ?? '0'),
          storedUnitPrice: String(r.stored_unit_price ?? '0'),
          storedTotalPrice: String(r.stored_total_price ?? '0'),
          catalogUnitPrice: String(r.catalog_unit_price ?? '0'),
          expectedTotalPrice: expectedTotal.toFixed(2),
          difference: (expectedTotal - storedTotal).toFixed(2),
        };
      })
      .sort((a, b) => {
        // Most recent first; rows without a work date go to the bottom.
        const ta = a.workDate ? a.workDate.getTime() : 0;
        const tb = b.workDate ? b.workDate.getTime() : 0;
        if (tb !== ta) return tb - ta;
        return b.parentId - a.parentId;
      });
  }

  async repriceBillingSheetItems(
    selection: Array<{ source: 'billing_sheet' | 'work_order' | 'invoice'; itemId: number }>,
    companyId: number | null,
    options: { dryRun: boolean; performedByUserId: number | null; performedByName: string | null }
  ) {
    const allBad = await this.getZeroPriceCatalogItems(companyId);
    const selectionKey = (s: 'billing_sheet' | 'work_order' | 'invoice', id: number) => `${s}:${id}`;
    const wantSet = new Set(selection.map((s) => selectionKey(s.source, s.itemId)));
    const targets = selection.length === 0
      ? allBad
      : allBad.filter((row) => wantSet.has(selectionKey(row.source, row.itemId)));

    // Group by parent (sheet, work order, or invoice) so subtotals are recomputed once each.
    const byParent = new Map<string, typeof targets>();
    for (const row of targets) {
      const k = `${row.source}:${row.parentId}`;
      const arr = byParent.get(k) ?? [];
      arr.push(row);
      byParent.set(k, arr);
    }

    type ParentSummary = {
      source: 'billing_sheet' | 'work_order' | 'invoice';
      parentId: number;
      parentNumber: string;
      oldPartsSubtotal: string;
      newPartsSubtotal: string;
      oldTotalAmount: string;
      newTotalAmount: string;
      updatedItems: Array<{
        itemId: number;
        partName: string;
        oldUnitPrice: string;
        newUnitPrice: string;
        oldTotalPrice: string;
        newTotalPrice: string;
      }>;
    };
    const parentSummaries: ParentSummary[] = [];
    let grandDifference = 0;
    let totalItemCount = 0;

    // Task #210: removed `stamp` (was used to prefix audit text written into
    // `notes`). Audit lines now live only in `[AUDIT]` console logs.
    const actor = options.performedByName ?? (options.performedByUserId ? `user#${options.performedByUserId}` : 'admin');

    // Task #212: resolve actor user once. If the id doesn't reference a real
    // user (test fixtures, deleted accounts), null it out so the FK insert
    // into pricing_audit_events doesn't blow up the whole repair transaction.
    let effectiveActorUserId: number | null = options.performedByUserId ?? null;
    if (effectiveActorUserId != null) {
      const u = await this.getUser(effectiveActorUserId).catch(() => null);
      if (!u) effectiveActorUserId = null;
    }

    type ZeroPriceRow = typeof allBad[number];
    for (const rows of Array.from(byParent.values()) as ZeroPriceRow[][]) {
      const sample = rows[0];
      if (!sample) continue;
      const updatedItems = rows.map((r: ZeroPriceRow) => ({
        itemId: r.itemId,
        partName: r.partName,
        oldUnitPrice: parseFloat(r.storedUnitPrice).toFixed(2),
        newUnitPrice: parseFloat(r.catalogUnitPrice).toFixed(2),
        oldTotalPrice: parseFloat(r.storedTotalPrice).toFixed(2),
        newTotalPrice: parseFloat(r.expectedTotalPrice).toFixed(2),
      }));
      const parentDifference = rows.reduce(
        (sum: number, r: ZeroPriceRow) => sum + parseFloat(r.difference),
        0,
      );

      if (sample.source === 'billing_sheet') {
        const sheetId = sample.parentId;
        const [sheet] = await db.select().from(billingSheets).where(eq(billingSheets.id, sheetId));
        if (!sheet) continue;
        const oldPartsSubtotal = parseFloat(String(sheet.partsSubtotal ?? 0));
        const oldTotalAmount = parseFloat(String(sheet.totalAmount ?? 0));
        const oldLaborSubtotal = parseFloat(String(sheet.laborSubtotal ?? 0));
        const newPartsSubtotal = oldPartsSubtotal + parentDifference;
        const newTotalAmount = oldLaborSubtotal + newPartsSubtotal;

        parentSummaries.push({
          source: 'billing_sheet',
          parentId: sheetId,
          parentNumber: sheet.billingNumber,
          oldPartsSubtotal: oldPartsSubtotal.toFixed(2),
          newPartsSubtotal: newPartsSubtotal.toFixed(2),
          oldTotalAmount: oldTotalAmount.toFixed(2),
          newTotalAmount: newTotalAmount.toFixed(2),
          updatedItems,
        });
        grandDifference += parentDifference;
        totalItemCount += rows.length;

        if (!options.dryRun) {
          await db.transaction(async (tx) => {
            for (const r of rows) {
              await tx.update(billingSheetItems)
                .set({
                  unitPrice: parseFloat(r.catalogUnitPrice).toFixed(2),
                  totalPrice: parseFloat(r.expectedTotalPrice).toFixed(2),
                })
                .where(eq(billingSheetItems.id, r.itemId));
            }
            const refreshedItems = await tx.select().from(billingSheetItems)
              .where(eq(billingSheetItems.billingSheetId, sheetId));
            const truePartsSubtotal = refreshedItems.reduce(
              (sum, item) => sum + parseFloat(String(item.totalPrice ?? 0)),
              0,
            );
            const trueTotal = oldLaborSubtotal + truePartsSubtotal;
            // Task #210: do NOT write the audit note into billing_sheets.notes.
            // That column is shown to managers in the UI and previously leaked
            // into the customer-facing PDF "WORK PERFORMED" section. The audit
            // trail still lives in the [AUDIT] log line below.
            await tx.update(billingSheets)
              .set({
                partsSubtotal: truePartsSubtotal.toFixed(2),
                totalAmount: trueTotal.toFixed(2),
              })
              .where(eq(billingSheets.id, sheetId));
            // Task #212: structured audit event so managers can see this in
            // the History panel on the billing-sheet detail view.
            await tx.insert(pricingAuditEvents).values({
              companyId: companyId ?? null,
              source: 'billing_sheet',
              parentId: sheetId,
              parentNumber: sheet.billingNumber,
              kind: 'catalog_reprice',
              delta: parentDifference.toFixed(2),
              itemCount: rows.length,
              actorUserId: effectiveActorUserId,
              actorName: options.performedByName ?? null,
              details: {
                oldPartsSubtotal: oldPartsSubtotal.toFixed(2),
                newPartsSubtotal: truePartsSubtotal.toFixed(2),
                oldTotalAmount: oldTotalAmount.toFixed(2),
                newTotalAmount: trueTotal.toFixed(2),
                items: updatedItems,
              },
            });
            console.log(
              `[AUDIT] billing_sheet_repriced billingSheetId=${sheetId} billingNumber=${sheet.billingNumber} ` +
              `itemCount=${rows.length} delta=${parentDifference.toFixed(2)} ` +
              `newPartsSubtotal=${truePartsSubtotal.toFixed(2)} newTotalAmount=${trueTotal.toFixed(2)} actor=${actor}`
            );
          });
        }
      } else if (sample.source === 'work_order') {
        const workOrderId = sample.parentId;
        const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
        if (!wo) continue;
        const oldPartsSubtotal = parseFloat(String(wo.partsSubtotal ?? wo.totalPartsCost ?? 0));
        const oldTotalAmount = parseFloat(String(wo.totalAmount ?? 0));

        parentSummaries.push({
          source: 'work_order',
          parentId: workOrderId,
          parentNumber: wo.workOrderNumber,
          oldPartsSubtotal: oldPartsSubtotal.toFixed(2),
          // We will report the recomputed totals after the transaction; for the
          // dry-run case we approximate them by adding the delta.
          newPartsSubtotal: (oldPartsSubtotal + parentDifference).toFixed(2),
          oldTotalAmount: oldTotalAmount.toFixed(2),
          newTotalAmount: (oldTotalAmount + parentDifference).toFixed(2),
          updatedItems,
        });
        grandDifference += parentDifference;
        totalItemCount += rows.length;

        if (!options.dryRun) {
          await db.transaction(async (tx) => {
            for (const r of rows) {
              await tx.update(workOrderItems)
                .set({
                  partPrice: parseFloat(r.catalogUnitPrice).toFixed(2),
                  totalPrice: parseFloat(r.expectedTotalPrice).toFixed(2),
                })
                .where(eq(workOrderItems.id, r.itemId));
            }
            const refreshedItems = await tx.select().from(workOrderItems)
              .where(eq(workOrderItems.workOrderId, workOrderId));
            const truePartsCost = refreshedItems.reduce(
              (sum, item) => sum + parseFloat(String(item.totalPrice ?? 0)),
              0,
            );

            // Recompute the work-order financial breakdown using its snapshotted
            // applied rates (matches the live PATCH behaviour). If the snapshot
            // is missing applied rates (legacy record), only update totalPartsCost
            // and append the audit note.
            const updates: Record<string, string> = {
              totalPartsCost: truePartsCost.toFixed(2),
            };
            const snappedLabor = parseFloat(String(wo.appliedLaborRate ?? ''));
            if (Number.isFinite(snappedLabor)) {
              const hrs = parseFloat(String(wo.totalHours ?? '0'));
              const laborSub = hrs * snappedLabor;
              const total = laborSub + truePartsCost;
              updates.laborSubtotal = laborSub.toFixed(2);
              updates.partsSubtotal = truePartsCost.toFixed(2);
              updates.totalAmount = total.toFixed(2);
            }

            // Task #210: do NOT write the audit note into work_orders.notes.
            // The [AUDIT] log line below preserves the audit trail in server logs.
            await tx.update(workOrders).set(updates).where(eq(workOrders.id, workOrderId));
            // Task #212: structured audit event for the History panel.
            await tx.insert(pricingAuditEvents).values({
              companyId: companyId ?? null,
              source: 'work_order',
              parentId: workOrderId,
              parentNumber: wo.workOrderNumber,
              kind: 'catalog_reprice',
              delta: parentDifference.toFixed(2),
              itemCount: rows.length,
              actorUserId: effectiveActorUserId,
              actorName: options.performedByName ?? null,
              details: {
                oldPartsSubtotal: oldPartsSubtotal.toFixed(2),
                newTotalPartsCost: truePartsCost.toFixed(2),
                oldTotalAmount: oldTotalAmount.toFixed(2),
                items: updatedItems,
              },
            });
            console.log(
              `[AUDIT] work_order_repriced workOrderId=${workOrderId} workOrderNumber=${wo.workOrderNumber} ` +
              `itemCount=${rows.length} delta=${parentDifference.toFixed(2)} ` +
              `newTotalPartsCost=${truePartsCost.toFixed(2)} actor=${actor}`
            );
          });
        }
      } else {
        // invoice
        const invoiceId = sample.parentId;
        const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
        if (!inv) continue;
        const oldPartsSubtotal = parseFloat(String(inv.partsSubtotal ?? 0));
        const oldTotalAmount = parseFloat(String(inv.totalAmount ?? 0));

        parentSummaries.push({
          source: 'invoice',
          parentId: invoiceId,
          parentNumber: inv.invoiceNumber,
          oldPartsSubtotal: oldPartsSubtotal.toFixed(2),
          // Dry-run approximation: the delta flows straight through to the
          // parts subtotal and the invoice grand total (labor is
          // not recomputed here because Tasks #160/#161 leave applied-rate
          // recompute to the live invoice generation flow).
          newPartsSubtotal: (oldPartsSubtotal + parentDifference).toFixed(2),
          oldTotalAmount: oldTotalAmount.toFixed(2),
          newTotalAmount: (oldTotalAmount + parentDifference).toFixed(2),
          updatedItems,
        });
        grandDifference += parentDifference;
        totalItemCount += rows.length;

        if (!options.dryRun) {
          await db.transaction(async (tx) => {
            for (const r of rows) {
              await tx.update(invoiceItems)
                .set({
                  unitPrice: parseFloat(r.catalogUnitPrice).toFixed(2),
                  totalPrice: parseFloat(r.expectedTotalPrice).toFixed(2),
                })
                .where(eq(invoiceItems.id, r.itemId));
            }
            const newPartsSubtotal = oldPartsSubtotal + parentDifference;
            const newTotalAmount = oldTotalAmount + parentDifference;
            await tx.update(invoices)
              .set({
                partsSubtotal: newPartsSubtotal.toFixed(2),
                totalAmount: newTotalAmount.toFixed(2),
                updatedAt: new Date(),
              })
              .where(eq(invoices.id, invoiceId));
            console.log(
              `[AUDIT] invoice_repriced invoiceId=${invoiceId} invoiceNumber=${inv.invoiceNumber} ` +
              `itemCount=${rows.length} delta=${parentDifference.toFixed(2)} ` +
              `newPartsSubtotal=${newPartsSubtotal.toFixed(2)} newTotalAmount=${newTotalAmount.toFixed(2)} actor=${actor}`
            );
          });
        }
      }
    }

    return {
      dryRun: options.dryRun,
      parentCount: parentSummaries.length,
      itemCount: totalItemCount,
      totalDifference: grandDifference.toFixed(2),
      parents: parentSummaries,
    };
  }
  // ─── /Catalog $0-price audit / backfill ─────────────────────────────────────

  // ─── Labor Rate Mismatch audit (Task #200) ──────────────────────────────────
  // Lists every un-invoiced Work Order and Billing Sheet whose stored
  // labor_rate does not match BOTH the customer's current standard rate AND
  // the customer's current emergency rate. The "inferred classification" is
  // whichever current rate the stored rate is numerically closest to —
  // admins can override this in the UI before applying the repair.
  async getLaborRateMismatchTickets(companyId: number | null) {
    const billingRows = await db.execute(sql`
      SELECT
        'billing_sheet'::text     AS source,
        bs.id                     AS parent_id,
        bs.billing_number         AS parent_number,
        bs.customer_id            AS customer_id,
        bs.customer_name          AS customer_name,
        bs.work_date              AS work_date,
        bs.technician_name        AS technician_name,
        bs.status                 AS status,
        bs.total_hours            AS total_hours,
        bs.labor_rate             AS stored_labor_rate,
        bs.labor_subtotal         AS stored_labor_subtotal,
        bs.parts_subtotal         AS stored_parts_subtotal,
        bs.total_amount           AS stored_total_amount,
        c.labor_rate              AS customer_standard_rate,
        c.emergency_labor_rate    AS customer_emergency_rate
      FROM billing_sheets bs
      INNER JOIN customers c ON c.id = bs.customer_id
      WHERE bs.invoice_id IS NULL
        AND bs.customer_id IS NOT NULL
        AND bs.labor_rate IS NOT NULL
        AND c.labor_rate IS NOT NULL
        AND c.emergency_labor_rate IS NOT NULL
        AND ABS(CAST(bs.labor_rate AS DOUBLE PRECISION) - CAST(c.labor_rate AS DOUBLE PRECISION)) > 0.005
        AND ABS(CAST(bs.labor_rate AS DOUBLE PRECISION) - CAST(c.emergency_labor_rate AS DOUBLE PRECISION)) > 0.005
        AND (${companyId}::int IS NULL OR c.company_id = ${companyId}::int)
    `);

    const workOrderRows = await db.execute(sql`
      SELECT
        'work_order'::text          AS source,
        wo.id                       AS parent_id,
        wo.work_order_number        AS parent_number,
        wo.customer_id              AS customer_id,
        wo.customer_name            AS customer_name,
        wo.scheduled_date           AS work_date,
        wo.assigned_technician_name AS technician_name,
        wo.status                   AS status,
        wo.total_hours              AS total_hours,
        COALESCE(wo.applied_labor_rate, wo.labor_rate) AS stored_labor_rate,
        wo.labor_subtotal           AS stored_labor_subtotal,
        wo.parts_subtotal           AS stored_parts_subtotal,
        wo.total_amount             AS stored_total_amount,
        c.labor_rate                AS customer_standard_rate,
        c.emergency_labor_rate      AS customer_emergency_rate
      FROM work_orders wo
      INNER JOIN customers c ON c.id = wo.customer_id
      WHERE wo.invoice_id IS NULL
        AND COALESCE(wo.applied_labor_rate, wo.labor_rate) IS NOT NULL
        AND c.labor_rate IS NOT NULL
        AND c.emergency_labor_rate IS NOT NULL
        AND ABS(CAST(COALESCE(wo.applied_labor_rate, wo.labor_rate) AS DOUBLE PRECISION) - CAST(c.labor_rate AS DOUBLE PRECISION)) > 0.005
        AND ABS(CAST(COALESCE(wo.applied_labor_rate, wo.labor_rate) AS DOUBLE PRECISION) - CAST(c.emergency_labor_rate AS DOUBLE PRECISION)) > 0.005
        AND (${companyId}::int IS NULL OR c.company_id = ${companyId}::int)
    `);

    const merged = [...billingRows.rows, ...workOrderRows.rows] as Array<Record<string, unknown>>;
    return merged
      .map((r) => {
        const totalHours = parseFloat(String(r.total_hours ?? 0));
        const storedRate = parseFloat(String(r.stored_labor_rate ?? 0));
        const storedPartsSubtotal = parseFloat(String(r.stored_parts_subtotal ?? 0));
        const storedTotalAmount = parseFloat(String(r.stored_total_amount ?? 0));
        const standardRate = parseFloat(String(r.customer_standard_rate ?? 0));
        const emergencyRate = parseFloat(String(r.customer_emergency_rate ?? 0));
        const distStandard = Math.abs(storedRate - standardRate);
        const distEmergency = Math.abs(storedRate - emergencyRate);
        const inferredClassification: 'standard' | 'emergency' =
          distEmergency < distStandard ? 'emergency' : 'standard';
        const expectedRate = inferredClassification === 'emergency' ? emergencyRate : standardRate;
        const expectedLaborSubtotal = totalHours * expectedRate;
        const expectedTotalAmount = expectedLaborSubtotal + storedPartsSubtotal;
        const workDate = r.work_date
          ? (r.work_date instanceof Date ? r.work_date : new Date(String(r.work_date)))
          : null;
        return {
          source: r.source as 'work_order' | 'billing_sheet',
          parentId: Number(r.parent_id),
          parentNumber: String(r.parent_number ?? ''),
          customerId: r.customer_id == null ? null : Number(r.customer_id),
          customerName: String(r.customer_name ?? ''),
          workDate,
          technicianName: String(r.technician_name ?? ''),
          status: String(r.status ?? ''),
          totalHours: totalHours.toFixed(2),
          storedLaborRate: storedRate.toFixed(2),
          storedLaborSubtotal: (parseFloat(String(r.stored_labor_subtotal ?? 0))).toFixed(2),
          storedPartsSubtotal: storedPartsSubtotal.toFixed(2),
          storedTotalAmount: storedTotalAmount.toFixed(2),
          customerStandardRate: standardRate.toFixed(2),
          customerEmergencyRate: emergencyRate.toFixed(2),
          inferredClassification,
          expectedLaborRate: expectedRate.toFixed(2),
          expectedLaborSubtotal: expectedLaborSubtotal.toFixed(2),
          expectedTotalAmount: expectedTotalAmount.toFixed(2),
        };
      })
      .sort((a, b) => {
        const ta = a.workDate ? a.workDate.getTime() : 0;
        const tb = b.workDate ? b.workDate.getTime() : 0;
        if (tb !== ta) return tb - ta;
        return b.parentId - a.parentId;
      });
  }

  async repriceLaborRateMismatches(
    selection: Array<{ source: 'work_order' | 'billing_sheet'; parentId: number; classification: 'standard' | 'emergency' }>,
    companyId: number | null,
    options: { dryRun: boolean; performedByUserId: number | null; performedByName: string | null }
  ) {
    type ParentSummary = {
      source: 'work_order' | 'billing_sheet';
      parentId: number;
      parentNumber: string;
      classification: 'standard' | 'emergency';
      oldLaborRate: string;
      newLaborRate: string;
      oldLaborSubtotal: string;
      newLaborSubtotal: string;
      oldTotalAmount: string;
      newTotalAmount: string;
    };
    const parents: ParentSummary[] = [];
    const skipped: Array<{ source: 'work_order' | 'billing_sheet'; parentId: number; reason: string }> = [];
    let grandDifference = 0;

    // Task #210: removed `stamp` (was used to prefix audit text written into
    // `notes`). Audit lines now live only in `[AUDIT]` console logs.
    const actor = options.performedByName ?? (options.performedByUserId ? `user#${options.performedByUserId}` : 'admin');

    // Task #212: resolve actor user once (see repriceBillingSheetItems).
    let effectiveActorUserId: number | null = options.performedByUserId ?? null;
    if (effectiveActorUserId != null) {
      const u = await this.getUser(effectiveActorUserId).catch(() => null);
      if (!u) effectiveActorUserId = null;
    }

    // De-duplicate: last classification wins for a given (source, parentId)
    const wantMap = new Map<string, 'standard' | 'emergency'>();
    for (const s of selection) {
      wantMap.set(`${s.source}:${s.parentId}`, s.classification);
    }

    for (const [key, classification] of Array.from(wantMap.entries())) {
      const [src, idStr] = key.split(':');
      const source = src as 'work_order' | 'billing_sheet';
      const parentId = parseInt(idStr);
      if (!Number.isFinite(parentId)) continue;

      if (source === 'billing_sheet') {
        const [sheet] = await db.select().from(billingSheets).where(eq(billingSheets.id, parentId));
        if (!sheet) {
          skipped.push({ source, parentId, reason: 'Billing sheet not found' });
          continue;
        }
        // Re-validate that the sheet is still un-invoiced at write time
        if (sheet.invoiceId != null) {
          skipped.push({ source, parentId, reason: 'Already invoiced' });
          continue;
        }
        if (!sheet.customerId) {
          skipped.push({ source, parentId, reason: 'Billing sheet has no customer' });
          continue;
        }
        if (companyId != null) {
          const [cust] = await db.select().from(customers).where(eq(customers.id, sheet.customerId));
          if (!cust || cust.companyId !== companyId) {
            skipped.push({ source, parentId, reason: 'Outside scope' });
            continue;
          }
        }
        const [customer] = await db.select().from(customers).where(eq(customers.id, sheet.customerId));
        if (!customer) {
          skipped.push({ source, parentId, reason: 'Customer not found' });
          continue;
        }
        const newRateStr = classification === 'emergency'
          ? customer.emergencyLaborRate
          : customer.laborRate;
        const newRate = newRateStr != null ? parseFloat(String(newRateStr)) : NaN;
        if (!Number.isFinite(newRate) || newRate <= 0) {
          skipped.push({
            source,
            parentId,
            reason: `Customer is missing a valid ${classification} labor rate; configure it on the customer profile before re-pricing.`,
          });
          continue;
        }
        const totalHours = parseFloat(String(sheet.totalHours ?? 0));
        const partsSubtotal = parseFloat(String(sheet.partsSubtotal ?? 0));
        const oldRate = parseFloat(String(sheet.laborRate ?? 0));
        const oldLaborSubtotal = parseFloat(String(sheet.laborSubtotal ?? 0));
        const oldTotalAmount = parseFloat(String(sheet.totalAmount ?? 0));
        if (Math.abs(oldRate - newRate) < 0.005) {
          skipped.push({
            source,
            parentId,
            reason: `Already in sync at $${newRate.toFixed(2)} (${classification}).`,
          });
          continue;
        }
        const newLaborSubtotal = totalHours * newRate;
        const newTotalAmount = newLaborSubtotal + partsSubtotal;
        const delta = newTotalAmount - oldTotalAmount;

        parents.push({
          source: 'billing_sheet',
          parentId,
          parentNumber: sheet.billingNumber,
          classification,
          oldLaborRate: oldRate.toFixed(2),
          newLaborRate: newRate.toFixed(2),
          oldLaborSubtotal: oldLaborSubtotal.toFixed(2),
          newLaborSubtotal: newLaborSubtotal.toFixed(2),
          oldTotalAmount: oldTotalAmount.toFixed(2),
          newTotalAmount: newTotalAmount.toFixed(2),
        });
        grandDifference += delta;

        if (!options.dryRun) {
          // Task #210: do NOT write the audit note into billing_sheets.notes.
          // The [AUDIT] log line below preserves the audit trail in server logs.
          // Task #212: write the structured audit event in the same transaction
          // as the rate update so the History panel can never disagree with
          // what was applied.
          await db.transaction(async (tx) => {
            await tx.update(billingSheets)
              .set({
                laborRate: newRate.toFixed(2),
                laborSubtotal: newLaborSubtotal.toFixed(2),
                totalAmount: newTotalAmount.toFixed(2),
              })
              .where(eq(billingSheets.id, parentId));
            await tx.insert(pricingAuditEvents).values({
              companyId: companyId ?? null,
              source: 'billing_sheet',
              parentId,
              parentNumber: sheet.billingNumber,
              kind: 'labor_rate_reprice',
              delta: delta.toFixed(2),
              itemCount: 0,
              actorUserId: effectiveActorUserId,
              actorName: options.performedByName ?? null,
              details: {
                classification,
                oldLaborRate: oldRate.toFixed(2),
                newLaborRate: newRate.toFixed(2),
                oldLaborSubtotal: oldLaborSubtotal.toFixed(2),
                newLaborSubtotal: newLaborSubtotal.toFixed(2),
                oldTotalAmount: oldTotalAmount.toFixed(2),
                newTotalAmount: newTotalAmount.toFixed(2),
                totalHours: totalHours.toFixed(2),
              },
            });
          });
          console.log(
            `[AUDIT] billing_sheet_labor_repriced billingSheetId=${parentId} billingNumber=${sheet.billingNumber} ` +
            `classification=${classification} oldRate=${oldRate.toFixed(2)} newRate=${newRate.toFixed(2)} ` +
            `delta=${delta.toFixed(2)} actor=${actor}`
          );
        }
      } else {
        // work_order
        const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, parentId));
        if (!wo) {
          skipped.push({ source, parentId, reason: 'Work order not found' });
          continue;
        }
        if (wo.invoiceId != null) {
          skipped.push({ source, parentId, reason: 'Already invoiced' });
          continue;
        }
        if (!wo.customerId) {
          skipped.push({ source, parentId, reason: 'Work order has no customer' });
          continue;
        }
        if (companyId != null) {
          const [cust] = await db.select().from(customers).where(eq(customers.id, wo.customerId));
          if (!cust || cust.companyId !== companyId) {
            skipped.push({ source, parentId, reason: 'Outside scope' });
            continue;
          }
        }
        const [customer] = await db.select().from(customers).where(eq(customers.id, wo.customerId));
        if (!customer) {
          skipped.push({ source, parentId, reason: 'Customer not found' });
          continue;
        }
        const newRateStr = classification === 'emergency'
          ? customer.emergencyLaborRate
          : customer.laborRate;
        const newRate = newRateStr != null ? parseFloat(String(newRateStr)) : NaN;
        if (!Number.isFinite(newRate) || newRate <= 0) {
          skipped.push({
            source,
            parentId,
            reason: `Customer is missing a valid ${classification} labor rate; configure it on the customer profile before re-pricing.`,
          });
          continue;
        }
        const totalHours = parseFloat(String(wo.totalHours ?? 0));
        const partsSubtotal = parseFloat(String(wo.partsSubtotal ?? wo.totalPartsCost ?? 0));
        const oldRate = parseFloat(String(wo.appliedLaborRate ?? wo.laborRate ?? 0));
        const oldLaborSubtotal = parseFloat(String(wo.laborSubtotal ?? 0));
        const oldTotalAmount = parseFloat(String(wo.totalAmount ?? 0));
        if (Math.abs(oldRate - newRate) < 0.005) {
          skipped.push({
            source,
            parentId,
            reason: `Already in sync at $${newRate.toFixed(2)} (${classification}).`,
          });
          continue;
        }
        const newLaborSubtotal = totalHours * newRate;
        const newTotalAmount = newLaborSubtotal + partsSubtotal;
        const delta = newTotalAmount - oldTotalAmount;

        parents.push({
          source: 'work_order',
          parentId,
          parentNumber: wo.workOrderNumber,
          classification,
          oldLaborRate: oldRate.toFixed(2),
          newLaborRate: newRate.toFixed(2),
          oldLaborSubtotal: oldLaborSubtotal.toFixed(2),
          newLaborSubtotal: newLaborSubtotal.toFixed(2),
          oldTotalAmount: oldTotalAmount.toFixed(2),
          newTotalAmount: newTotalAmount.toFixed(2),
        });
        grandDifference += delta;

        if (!options.dryRun) {
          // Task #210: do NOT write the audit note into work_orders.notes.
          // The [AUDIT] log line below preserves the audit trail in server logs.
          // Task #212: write the structured audit event in the same transaction.
          await db.transaction(async (tx) => {
            await tx.update(workOrders)
              .set({
                laborRate: newRate.toFixed(2),
                appliedLaborRate: newRate.toFixed(2),
                laborSubtotal: newLaborSubtotal.toFixed(2),
                totalAmount: newTotalAmount.toFixed(2),
              })
              .where(eq(workOrders.id, parentId));
            await tx.insert(pricingAuditEvents).values({
              companyId: companyId ?? null,
              source: 'work_order',
              parentId,
              parentNumber: wo.workOrderNumber,
              kind: 'labor_rate_reprice',
              delta: delta.toFixed(2),
              itemCount: 0,
              actorUserId: effectiveActorUserId,
              actorName: options.performedByName ?? null,
              details: {
                classification,
                oldLaborRate: oldRate.toFixed(2),
                newLaborRate: newRate.toFixed(2),
                oldLaborSubtotal: oldLaborSubtotal.toFixed(2),
                newLaborSubtotal: newLaborSubtotal.toFixed(2),
                oldTotalAmount: oldTotalAmount.toFixed(2),
                newTotalAmount: newTotalAmount.toFixed(2),
                totalHours: totalHours.toFixed(2),
              },
            });
          });
          console.log(
            `[AUDIT] work_order_labor_repriced workOrderId=${parentId} workOrderNumber=${wo.workOrderNumber} ` +
            `classification=${classification} oldRate=${oldRate.toFixed(2)} newRate=${newRate.toFixed(2)} ` +
            `delta=${delta.toFixed(2)} actor=${actor}`
          );
        }
      }
    }

    return {
      dryRun: options.dryRun,
      parentCount: parents.length,
      totalDifference: grandDifference.toFixed(2),
      parents,
      skipped,
    };
  }
  // ─── /Labor Rate Mismatch audit ─────────────────────────────────────────────

  // ─── Pricing audit events (Task #212) ──────────────────────────────────────
  async getPricingAuditEvents(
    source: 'billing_sheet' | 'work_order' | 'invoice',
    parentId: number,
    companyId?: number | null,
  ): Promise<PricingAuditEvent[]> {
    const conditions = [
      eq(pricingAuditEvents.source, source),
      eq(pricingAuditEvents.parentId, parentId),
    ];
    // Hard company scoping: when companyId is provided, only return rows that
    // belong to that company. Rows with NULL companyId are NOT exposed under a
    // scoped read — that prevents legacy/unscoped events from leaking across
    // company boundaries.
    if (companyId != null) {
      conditions.push(eq(pricingAuditEvents.companyId, companyId));
    }
    return await db.select()
      .from(pricingAuditEvents)
      .where(and(...conditions))
      .orderBy(desc(pricingAuditEvents.createdAt));
  }
  // ─── /Pricing audit events ─────────────────────────────────────────────────

  // ─── Photo late-addition audit (Task #195) ─────────────────────────────────
  async recordPhotoLateAddition(input: InsertPhotoLateAddition): Promise<PhotoLateAddition> {
    const [row] = await db.insert(photoLateAdditions).values(input).returning();
    return row;
  }

  async getPhotoLateAdditions(
    ticketType: 'work_order' | 'billing_sheet',
    ticketId: number,
    companyId?: number | null,
  ): Promise<PhotoLateAddition[]> {
    const conditions = [
      eq(photoLateAdditions.ticketType, ticketType),
      eq(photoLateAdditions.ticketId, ticketId),
    ];
    if (companyId != null) {
      conditions.push(eq(photoLateAdditions.companyId, companyId));
    }
    return await db.select()
      .from(photoLateAdditions)
      .where(and(...conditions))
      .orderBy(desc(photoLateAdditions.createdAt));
  }
  // ─── /Photo late-addition audit ────────────────────────────────────────────

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

  async getMissingPhotosNotifications(): Promise<MissingPhotosNotification[]> {
    return await db.select().from(missingPhotosNotifications);
  }

  async upsertMissingPhotosNotification(
    technicianId: number,
    sheetIds: number[],
    sentByUserId: number | null,
    channel: 'email' | 'sms' = 'email',
    smsMessageSid: string | null = null,
  ): Promise<MissingPhotosNotification> {
    const now = new Date();
    let channelFields: Partial<typeof missingPhotosNotifications.$inferInsert>;
    if (channel === 'email') {
      channelFields = { lastSentEmailAt: now, lastEmailSheetCount: sheetIds.length };
    } else {
      // For SMS, also (re)seed the delivery tracking fields. We mark the
      // initial status as 'queued' since Twilio has just accepted the
      // message; the status callback webhook will update it as the message
      // moves through sent / delivered / failed / undelivered.
      channelFields = {
        lastSentSmsAt: now,
        lastSmsSheetCount: sheetIds.length,
        lastSmsMessageSid: smsMessageSid,
        lastSmsStatus: smsMessageSid ? 'queued' : null,
        lastSmsStatusAt: smsMessageSid ? now : null,
        lastSmsErrorCode: null,
      };
    }

    const insertValues: typeof missingPhotosNotifications.$inferInsert = {
      technicianId,
      sheetIds,
      sheetCount: sheetIds.length,
      lastSentAt: now,
      sentByUserId,
      ...channelFields,
    };
    const updateValues: Partial<typeof missingPhotosNotifications.$inferInsert> = {
      sheetIds,
      sheetCount: sheetIds.length,
      lastSentAt: now,
      sentByUserId,
      ...channelFields,
    };

    const [row] = await db
      .insert(missingPhotosNotifications)
      .values(insertValues)
      .onConflictDoUpdate({
        target: missingPhotosNotifications.technicianId,
        set: updateValues,
      })
      .returning();
    return row;
  }

  async updateMissingPhotosSmsStatus(
    messageSid: string,
    status: string,
    errorCode: string | null = null,
  ): Promise<MissingPhotosNotification | undefined> {
    // Monotonic status guard: Twilio status callbacks can arrive out of
    // order (e.g. a delayed 'sent' after a 'delivered'/'failed' callback).
    // Don't let an earlier-stage status overwrite a terminal one. Rank
    // each status; only persist when the incoming rank is >= the stored
    // rank.
    const rank = (s: string | null | undefined): number => {
      switch ((s ?? '').toLowerCase()) {
        case 'queued':
        case 'accepted':
        case 'scheduled':
          return 1;
        case 'sending':
          return 2;
        case 'sent':
          return 3;
        // Terminal states — equal rank so the most recent terminal callback
        // (e.g. 'delivered' superseded by a later 'failed') still updates.
        case 'delivered':
        case 'received':
        case 'failed':
        case 'undelivered':
          return 4;
        default:
          return 0;
      }
    };

    const [existing] = await db
      .select()
      .from(missingPhotosNotifications)
      .where(eq(missingPhotosNotifications.lastSmsMessageSid, messageSid));
    if (!existing) return undefined;

    if (rank(status) < rank(existing.lastSmsStatus)) {
      // Drop out-of-order earlier-stage callback; preserve terminal state.
      return existing;
    }

    const [row] = await db
      .update(missingPhotosNotifications)
      .set({
        lastSmsStatus: status,
        lastSmsStatusAt: new Date(),
        lastSmsErrorCode: errorCode,
      })
      .where(eq(missingPhotosNotifications.lastSmsMessageSid, messageSid))
      .returning();
    return row;
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
          eq(workOrders.status, "work_completed"),
          gte(workOrders.completedAt, periodStart),
          lte(workOrders.completedAt, periodEnd)
        )
      );
    
    // Get approved billing sheets for the period
    const approvedBillingSheets = await db.select()
      .from(billingSheets)
      .where(
        and(
          eq(billingSheets.status, "approved_passed_to_billing"),
          gte(billingSheets.workDate, periodStart),
          lte(billingSheets.workDate, periodEnd)
        )
      );
    
    // Group by customer
    const customerWork = new Map<number, { workOrders: WorkOrder[], billingSheets: BillingSheet[] }>();
    
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
    work: { workOrders: WorkOrder[], billingSheets: BillingSheet[] },
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
    
    const totalAmount = partsSubtotal + laborSubtotal;

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
      totalAmount: totalAmount.toString(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    }).returning();
    
    // Create invoice items from work orders.
    // Route through createInvoiceItem so the Task #161 catalog-price safeguard
    // also covers this legacy per-part insert path.
    for (const wo of work.workOrders) {
      const woItems = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, wo.id));
      for (const item of woItems) {
        await this.createInvoiceItem({
          invoiceId: newInvoice.id,
          sourceType: "work_order",
          sourceId: wo.id,
          workOrderId: wo.id,
          workDate: wo.completedAt || wo.startedAt || new Date(),
          description: wo.projectName || wo.description || '',
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
    
    // Create invoice items from billing sheets (also via createInvoiceItem).
    for (const bs of work.billingSheets) {
      const bsItems = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, bs.id));
      for (const item of bsItems) {
        await this.createInvoiceItem({
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

  async createInvoice(invoice: InsertInvoice & { invoiceNumber?: string }): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(toDrizzleInsert<DrizzleInvoiceInsert>(invoice)).returning();
    return newInvoice;
  }

  async updateInvoice(id: number, invoice: Partial<InsertInvoice> & { invoiceNumber?: string }): Promise<Invoice | undefined> {
    const [updatedInvoice] = await db.update(invoices).set(invoice).where(eq(invoices.id, id)).returning();
    return updatedInvoice || undefined;
  }

  async deleteInvoice(id: number): Promise<boolean> {
    const result = await db.delete(invoices).where(eq(invoices.id, id));
    return (result.rowCount || 0) > 0;
  }

  async deleteInvoiceItemsByInvoiceId(invoiceId: number): Promise<boolean> {
    const result = await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
    return (result.rowCount || 0) > 0;
  }

  // Task #161 safeguard: when an invoice line item references a catalog part
  // (partId), the catalog price is the authoritative source of truth. If the
  // catalog price is > 0 we override any client-supplied unitPrice/totalPrice
  // (mirrors Task #160 work-order/billing-sheet behaviour). If the partId
  // points to a missing/deleted part, we throw — silently dropping the row
  // would mask data quality issues.
  private async authoritativeInvoiceItemPrice(item: InsertInvoiceItem): Promise<InsertInvoiceItem> {
    if (item.partId == null) return item;
    const part = await this.getPart(item.partId);
    if (!part) {
      throw new Error(
        `Catalog part with ID ${item.partId} (line item "${item.partName ?? '?'}") was not found. Cannot save invoice line item.`,
      );
    }
    const catalogPrice = parseFloat(String(part.price ?? 0));
    if (!(catalogPrice > 0)) return item;
    const qty = parseFloat(String(item.quantity ?? 0));
    return {
      ...item,
      partName: item.partName || part.name,
      partDescription: item.partDescription ?? part.description ?? null,
      unitPrice: catalogPrice.toFixed(2),
      totalPrice: (qty * catalogPrice).toFixed(2),
    };
  }

  async createInvoiceItem(item: InsertInvoiceItem): Promise<InvoiceItem> {
    const corrected = await this.authoritativeInvoiceItemPrice(item);
    const [newItem] = await db.insert(invoiceItems).values(corrected).returning();
    return newItem;
  }

  async getInvoiceItems(invoiceId: number): Promise<InvoiceItem[]> {
    return await db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
  }

  // Invoice PDF methods
  async createInvoicePdf(pdf: InsertInvoicePdf): Promise<InvoicePdf> {
    const [newPdf] = await db.insert(invoicePdfs).values(pdf).returning();
    return newPdf;
  }

  async getInvoicePdfByInvoiceId(invoiceId: number): Promise<InvoicePdf | undefined> {
    const [pdf] = await db.select().from(invoicePdfs).where(eq(invoicePdfs.invoiceId, invoiceId));
    return pdf;
  }

  async updateInvoicePdf(id: number, pdf: Partial<InsertInvoicePdf>): Promise<InvoicePdf | undefined> {
    const [updated] = await db.update(invoicePdfs)
      .set(pdf)
      .where(eq(invoicePdfs.id, id))
      .returning();
    return updated;
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

  // API Keys methods
  async getApiKeys(companyId: number): Promise<ApiKey[]> {
    return await db.select().from(apiKeys)
      .where(eq(apiKeys.companyId, companyId))
      .orderBy(desc(apiKeys.createdAt));
  }

  async getApiKeyByKey(apiKey: string): Promise<ApiKey | undefined> {
    const results = await db.select().from(apiKeys)
      .where(and(eq(apiKeys.apiKey, apiKey), eq(apiKeys.isActive, true)));
    return results[0];
  }

  async createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
    const result = await db.insert(apiKeys).values(apiKey).returning();
    return result[0];
  }

  async deleteApiKey(id: number): Promise<boolean> {
    const result = await db.delete(apiKeys).where(eq(apiKeys.id, id));
    return (result.rowCount || 0) > 0;
  }

  async updateApiKeyLastUsed(id: number): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  }

  async getIrrigationManagerForCompany(companyId: number): Promise<User | undefined> {
    const results = await db.select().from(users)
      .where(and(
        eq(users.companyId, companyId),
        eq(users.role, 'irrigation_manager'),
        eq(users.isActive, true)
      ))
      .limit(1);
    return results[0];
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

  async getPopularParts(companyId: number, limit: number = 10): Promise<{ id: number; companyId: number; name: string; description: string | null; sku: string; category: string; price: string; usageCount: number }[]> {
    const results = await db.select({
      id: parts.id,
      companyId: parts.companyId,
      name: parts.name,
      description: parts.description,
      sku: parts.sku,
      category: parts.category,
      price: parts.price,
      usageCount: partUsage.usageCount
    })
    .from(parts)
    .innerJoin(partUsage, eq(parts.id, partUsage.partId))
    .where(eq(partUsage.companyId, companyId))
    .orderBy(desc(partUsage.usageCount), desc(partUsage.lastUsedAt))
    .limit(limit);

    return results;
  }

  // Default seed values for parts reference lists
  private readonly DEFAULT_CATEGORIES = [
    "Backflow", "Bushing", "Controller", "Decoder", "Filter", "Fitting",
    "Head", "Irrigation Box", "Labor", "Misc", "Module", "Nipple",
    "Nozzle", "Pipe", "Rental", "Service", "Valve", "Wire"
  ];
  private readonly DEFAULT_BRANDS = [
    "Hunter", "Rainbird", "Febco", "LEIT", "EBON", "Wilkins", "Mcdonald", "Leemco", "Ranier"
  ];
  private readonly DEFAULT_SIZES = [
    "0.125\"", "0.25\"", "0.375\"", "0.5\"", "0.75\"", "1\"", "1.25\"", "1.5\"",
    "2\"", "2.5\"", "3\"", "4\"", "6\"", "8\"", "10\"", "12\""
  ];
  private readonly DEFAULT_MATERIALS = [
    "PVC", "Copper", "Brass", "NETAFIM", "POLY", "BACKFLOW", "Insert"
  ];
  private readonly DEFAULT_FITTING_TYPES = [
    "90° Coupler", "45° Coupler", "Tee", "Union", "Cap", "Coupler", "Male Adapter",
    "Female Adapter", "Plug", "Slip-Fix", "Cross", "Manifold", "Ball Valve"
  ];

  async getPartCategories(companyId: number): Promise<PartCategory[]> {
    const existing = await db.select().from(partCategories).where(eq(partCategories.companyId, companyId));
    if (existing.length === 0) {
      const toInsert = this.DEFAULT_CATEGORIES.map(name => ({ companyId, name, markupPercent: "0.00" }));
      const seeded = await db.insert(partCategories).values(toInsert).returning();
      return seeded;
    }
    return existing;
  }

  async createPartCategory(category: InsertPartCategory): Promise<PartCategory> {
    const [result] = await db.insert(partCategories).values(category).returning();
    return result;
  }

  async updatePartCategory(id: number, companyId: number, data: Partial<InsertPartCategory>): Promise<PartCategory | undefined> {
    const [result] = await db.update(partCategories).set(data).where(and(eq(partCategories.id, id), eq(partCategories.companyId, companyId))).returning();
    return result;
  }

  async deletePartCategory(id: number, companyId: number): Promise<boolean> {
    const result = await db.delete(partCategories).where(and(eq(partCategories.id, id), eq(partCategories.companyId, companyId))).returning();
    return result.length > 0;
  }

  async getPartBrands(companyId: number): Promise<PartBrand[]> {
    const existing = await db.select().from(partBrands).where(eq(partBrands.companyId, companyId));
    if (existing.length === 0) {
      const toInsert = this.DEFAULT_BRANDS.map(name => ({ companyId, name }));
      const seeded = await db.insert(partBrands).values(toInsert).returning();
      return seeded;
    }
    return existing;
  }

  async createPartBrand(brand: InsertPartBrand): Promise<PartBrand> {
    const [result] = await db.insert(partBrands).values(brand).returning();
    return result;
  }

  async updatePartBrand(id: number, companyId: number, data: Partial<InsertPartBrand>): Promise<PartBrand | undefined> {
    const [result] = await db.update(partBrands).set(data).where(and(eq(partBrands.id, id), eq(partBrands.companyId, companyId))).returning();
    return result;
  }

  async deletePartBrand(id: number, companyId: number): Promise<boolean> {
    const result = await db.delete(partBrands).where(and(eq(partBrands.id, id), eq(partBrands.companyId, companyId))).returning();
    return result.length > 0;
  }

  async getPartSizes(companyId: number): Promise<PartSize[]> {
    const existing = await db.select().from(partSizes).where(eq(partSizes.companyId, companyId));
    if (existing.length === 0) {
      const toInsert = this.DEFAULT_SIZES.map(name => ({ companyId, name }));
      const seeded = await db.insert(partSizes).values(toInsert).returning();
      return seeded;
    }
    return existing;
  }

  async createPartSize(size: InsertPartSize): Promise<PartSize> {
    const [result] = await db.insert(partSizes).values(size).returning();
    return result;
  }

  async updatePartSize(id: number, companyId: number, data: Partial<InsertPartSize>): Promise<PartSize | undefined> {
    const [result] = await db.update(partSizes).set(data).where(and(eq(partSizes.id, id), eq(partSizes.companyId, companyId))).returning();
    return result;
  }

  async deletePartSize(id: number, companyId: number): Promise<boolean> {
    const result = await db.delete(partSizes).where(and(eq(partSizes.id, id), eq(partSizes.companyId, companyId))).returning();
    return result.length > 0;
  }

  async getPartMaterials(companyId: number): Promise<PartMaterial[]> {
    const existing = await db.select().from(partMaterials).where(eq(partMaterials.companyId, companyId));
    if (existing.length === 0) {
      const toInsert = this.DEFAULT_MATERIALS.map(name => ({ companyId, name }));
      const seeded = await db.insert(partMaterials).values(toInsert).returning();
      return seeded;
    }
    return existing;
  }

  async createPartMaterial(material: InsertPartMaterial): Promise<PartMaterial> {
    const [result] = await db.insert(partMaterials).values(material).returning();
    return result;
  }

  async updatePartMaterial(id: number, companyId: number, data: Partial<InsertPartMaterial>): Promise<PartMaterial | undefined> {
    const [result] = await db.update(partMaterials).set(data).where(and(eq(partMaterials.id, id), eq(partMaterials.companyId, companyId))).returning();
    return result;
  }

  async deletePartMaterial(id: number, companyId: number): Promise<boolean> {
    const result = await db.delete(partMaterials).where(and(eq(partMaterials.id, id), eq(partMaterials.companyId, companyId))).returning();
    return result.length > 0;
  }

  async getPartFittingTypes(companyId: number): Promise<PartFittingType[]> {
    const existing = await db.select().from(partFittingTypes).where(eq(partFittingTypes.companyId, companyId));
    if (existing.length === 0) {
      const toInsert = this.DEFAULT_FITTING_TYPES.map(name => ({ companyId, name }));
      const seeded = await db.insert(partFittingTypes).values(toInsert).returning();
      return seeded;
    }
    return existing;
  }

  async createPartFittingType(fittingType: InsertPartFittingType): Promise<PartFittingType> {
    const [result] = await db.insert(partFittingTypes).values(fittingType).returning();
    return result;
  }

  async updatePartFittingType(id: number, companyId: number, data: Partial<InsertPartFittingType>): Promise<PartFittingType | undefined> {
    const [result] = await db.update(partFittingTypes).set(data).where(and(eq(partFittingTypes.id, id), eq(partFittingTypes.companyId, companyId))).returning();
    return result;
  }

  async deletePartFittingType(id: number, companyId: number): Promise<boolean> {
    const result = await db.delete(partFittingTypes).where(and(eq(partFittingTypes.id, id), eq(partFittingTypes.companyId, companyId))).returning();
    return result.length > 0;
  }

  async createAiGenerationLog(log: InsertAiGenerationLog): Promise<AiGenerationLog> {
    const [result] = await db.insert(aiGenerationLogs).values(log).returning();
    return result;
  }

  // Manual Part Reviews
  async getManualPartReviews(companyId: number): Promise<ManualPartReview[]> {
    return await db.select().from(manualPartReviews)
      .where(and(eq(manualPartReviews.companyId, companyId), eq(manualPartReviews.approvalStatus, 'pending')))
      .orderBy(desc(manualPartReviews.createdAt));
  }

  async getManualPartReview(id: number): Promise<ManualPartReview | undefined> {
    const [result] = await db.select().from(manualPartReviews).where(eq(manualPartReviews.id, id));
    return result;
  }

  async createManualPartReview(review: InsertManualPartReview): Promise<ManualPartReview> {
    const [result] = await db.insert(manualPartReviews).values(review).returning();
    return result;
  }

  async approveManualPartReview(id: number, reviewedPrice: string): Promise<ManualPartReview | undefined> {
    const review = await this.getManualPartReview(id);
    if (!review) return undefined;

    // Update the review record
    const [updatedReview] = await db.update(manualPartReviews)
      .set({ approvalStatus: 'approved', reviewedPrice, approvedAt: new Date() })
      .where(eq(manualPartReviews.id, id))
      .returning();

    // If linked to a billing sheet item, update its unit price and recalculate total price
    if (review.billingSheetItemId) {
      const [linkedItem] = await db.select().from(billingSheetItems).where(eq(billingSheetItems.id, review.billingSheetItemId));
      const qty = linkedItem ? parseFloat(linkedItem.quantity ?? '1') : 1;
      const newTotal = (qty * parseFloat(reviewedPrice)).toFixed(2);
      await db.update(billingSheetItems)
        .set({ unitPrice: reviewedPrice, totalPrice: newTotal })
        .where(eq(billingSheetItems.id, review.billingSheetItemId));
    }

    return updatedReview;
  }

  // Parts Pending Approval
  async getPendingParts(companyId: number): Promise<Part[]> {
    return await db.select().from(parts)
      .where(and(eq(parts.companyId, companyId), eq(parts.approvalStatus, 'pending')))
      .orderBy(desc(parts.createdAt));
  }

  async approvePart(id: number, price: string, cost?: string, companyId?: number): Promise<Part | undefined> {
    // Update the part itself
    const updateFields: Partial<typeof parts.$inferInsert> = {
      approvalStatus: 'approved',
      approvedAt: new Date(),
      price,
      updatedAt: new Date(),
    };
    if (cost !== undefined) updateFields.cost = cost;

    const [updatedPart] = await db.update(parts)
      .set(updateFields)
      .where(eq(parts.id, id))
      .returning();

    if (!updatedPart) return undefined;

    // Propagate the new price to all uninvoiced billing_sheet_items referencing this part.
    // Parts are inherently company-scoped (each part belongs to one company), so filtering by
    // partId alone prevents cross-tenant contamination without needing a companyId join.
    const uninvoicedBillingSheets = await db.select({ id: billingSheets.id })
      .from(billingSheets)
      .where(isNull(billingSheets.invoiceId));

    if (uninvoicedBillingSheets.length > 0) {
      for (const bs of uninvoicedBillingSheets) {
        // Fetch the affected items so we can recalculate total_price per-item (quantity varies)
        const affectedItems = await db.select()
          .from(billingSheetItems)
          .where(and(eq(billingSheetItems.partId, id), eq(billingSheetItems.billingSheetId, bs.id)));
        for (const item of affectedItems) {
          const qty = parseFloat(item.quantity ?? '1');
          const newTotal = (qty * parseFloat(price)).toFixed(2);
          await db.update(billingSheetItems)
            .set({ unitPrice: price, totalPrice: newTotal })
            .where(eq(billingSheetItems.id, item.id));
        }
      }
    }

    // Propagate the new price to all uninvoiced work_order_items referencing this part.
    const uninvoicedWorkOrders = await db.select({ id: workOrders.id })
      .from(workOrders)
      .where(isNull(workOrders.invoiceId));

    if (uninvoicedWorkOrders.length > 0) {
      for (const wo of uninvoicedWorkOrders) {
        await db.update(workOrderItems)
          .set({ partPrice: price })
          .where(and(eq(workOrderItems.partId, id), eq(workOrderItems.workOrderId, wo.id)));
      }
    }

    return updatedPart;
  }

  // ── Wet Check System (Slice 2A) ───────────────────────────────────────────
  async listIssueTypeConfigs(companyId: number): Promise<IssueTypeConfig[]> {
    return await db.select().from(issueTypeConfigs)
      .where(and(eq(issueTypeConfigs.companyId, companyId), eq(issueTypeConfigs.isActive, true)))
      .orderBy(issueTypeConfigs.sortOrder);
  }

  async listAllIssueTypeConfigs(companyId: number): Promise<IssueTypeConfig[]> {
    return await db.select().from(issueTypeConfigs)
      .where(eq(issueTypeConfigs.companyId, companyId))
      .orderBy(issueTypeConfigs.sortOrder);
  }

  async createIssueTypeConfig(
    companyId: number,
    data: Omit<InsertIssueTypeConfig, "companyId">,
  ): Promise<IssueTypeConfig> {
    const [row] = await db.insert(issueTypeConfigs).values({
      ...data,
      companyId,
    }).returning();
    return row;
  }

  async updateIssueTypeConfig(
    companyId: number,
    id: number,
    patch: Partial<Omit<InsertIssueTypeConfig, "companyId">>,
  ): Promise<IssueTypeConfig | undefined> {
    const [row] = await db.update(issueTypeConfigs)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(issueTypeConfigs.id, id), eq(issueTypeConfigs.companyId, companyId)))
      .returning();
    return row;
  }

  async reorderIssueTypeConfigs(companyId: number, orderedIds: number[]): Promise<IssueTypeConfig[]> {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.update(issueTypeConfigs)
        .set({ sortOrder: (i + 1) * 10, updatedAt: new Date() })
        .where(and(
          eq(issueTypeConfigs.id, orderedIds[i]),
          eq(issueTypeConfigs.companyId, companyId),
        ));
    }
    return await this.listAllIssueTypeConfigs(companyId);
  }

  async getPartsByIssueType(companyId: number, issueType: string, customerId?: number | null): Promise<{ parts: Part[]; recentPartIds: number[] }> {
    const [cfg] = await db.select().from(issueTypeConfigs)
      .where(and(eq(issueTypeConfigs.companyId, companyId), eq(issueTypeConfigs.issueType, issueType)));
    const filter = cfg?.partCategoryFilter?.trim() ?? null;
    const conds = [eq(parts.companyId, companyId), eq(parts.approvalStatus, "approved")];
    if (filter) conds.push(ilike(parts.category, `%${filter}%`));
    const list = await db.select().from(parts).where(and(...conds)).orderBy(parts.name).limit(200);

    // Identify parts recently used at this property (last ~90 days of
    // billing-sheet items) so the field UI can show a "Recent at this
    // property" header above the rest of the list.
    let recentIds = new Set<number>();
    if (customerId) {
      const recent = await db.select({ partId: billingSheetItems.partId })
        .from(billingSheetItems)
        .innerJoin(billingSheets, eq(billingSheetItems.billingSheetId, billingSheets.id))
        .where(and(
          eq(billingSheets.customerId, customerId),
          sql`${billingSheets.workDate} >= NOW() - INTERVAL '90 days'`,
        ))
        .limit(200);
      recentIds = new Set<number>(recent.map(r => r.partId).filter((x): x is number => !!x));
      if (recentIds.size > 0) {
        list.sort((a, b) => {
          const ar = recentIds.has(a.id) ? 0 : 1;
          const br = recentIds.has(b.id) ? 0 : 1;
          if (ar !== br) return ar - br;
          return a.name.localeCompare(b.name);
        });
      }
    }
    return { parts: list, recentPartIds: Array.from(recentIds) };
  }

  async listPropertyControllers(companyId: number, customerId: number): Promise<PropertyController[]> {
    return await db.select().from(propertyControllers)
      .where(and(eq(propertyControllers.companyId, companyId), eq(propertyControllers.customerId, customerId)))
      .orderBy(propertyControllers.controllerLetter);
  }

  // Branch-name normalizer: a non-empty string is a real branch label;
  // anything else (undefined, null, "") collapses to NULL = "no branch /
  // customer-level" bucket. Centralized so every read/write path sees the
  // same convention.
  private branchKey(branchName?: string | null): string | null {
    if (typeof branchName !== "string") return null;
    const trimmed = branchName.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  // Drizzle helper: equality predicate that treats NULL and NULL as a match
  // (matching our COALESCE-based unique index). Postgres' `=` would return
  // NULL on either side being NULL.
  private branchEq(branchName: string | null) {
    return branchName === null
      ? sql`${propertyControllers.branchName} IS NULL`
      : eq(propertyControllers.branchName, branchName);
  }

  async ensurePropertyControllers(
    companyId: number,
    customerId: number,
    count: number,
    branchName?: string | null,
  ): Promise<PropertyController[]> {
    const branch = this.branchKey(branchName);
    const all = await this.listPropertyControllers(companyId, customerId);
    const inBranch = all.filter(c => (c.branchName ?? null) === branch);
    const haveLetters = new Set(inBranch.map(c => c.controllerLetter));
    const needed: string[] = [];
    for (let i = 0; i < count; i++) {
      const letter = String.fromCharCode("A".charCodeAt(0) + i);
      if (!haveLetters.has(letter)) needed.push(letter);
    }
    if (needed.length > 0) {
      await db.insert(propertyControllers)
        .values(needed.map(letter => ({
          companyId,
          customerId,
          branchName: branch,
          controllerLetter: letter,
          zoneCount: 100,
        })))
        .onConflictDoNothing();
    }
    const refreshed = await this.listPropertyControllers(companyId, customerId);
    return refreshed.filter(c => (c.branchName ?? null) === branch);
  }

  async upsertPropertyController(
    companyId: number,
    customerId: number,
    letter: string,
    values: { zoneCount: number; notes?: string },
    branchName?: string | null,
  ): Promise<PropertyController> {
    // Try update first (scoped to this branch). If no row exists yet for
    // this (customer, branch, letter), insert one. The composite-with-
    // COALESCE unique index makes Drizzle's onConflictDoUpdate awkward, so
    // we do the update-then-insert dance manually.
    const branch = this.branchKey(branchName);
    const [updated] = await db.update(propertyControllers)
      .set({
        zoneCount: values.zoneCount,
        ...(values.notes !== undefined ? { notes: values.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(propertyControllers.companyId, companyId),
        eq(propertyControllers.customerId, customerId),
        eq(propertyControllers.controllerLetter, letter),
        this.branchEq(branch),
      ))
      .returning();
    if (updated) return updated;
    const [inserted] = await db.insert(propertyControllers)
      .values({
        companyId,
        customerId,
        branchName: branch,
        controllerLetter: letter,
        zoneCount: values.zoneCount,
        notes: values.notes,
      })
      .returning();
    return inserted;
  }

  async updatePropertyController(
    companyId: number,
    customerId: number,
    letter: string,
    patch: { zoneCount?: number; notes?: string },
    branchName?: string | null,
  ): Promise<PropertyController | undefined> {
    const branch = this.branchKey(branchName);
    const [updated] = await db.update(propertyControllers)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(
        eq(propertyControllers.companyId, companyId),
        eq(propertyControllers.customerId, customerId),
        eq(propertyControllers.controllerLetter, letter),
        this.branchEq(branch),
      ))
      .returning();
    if (!updated) return undefined;

    // Shrink side effect: when zoneCount drops, mark ALL zone records above
    // the new count as not_applicable on every in-progress wet check for this
    // property/controller — including ones already marked YES/NO. Spec: zones
    // that don't exist on the controller cannot remain "checked".
    //
    // Per task #312: wet-check capture is customer-level only (no per-branch
    // wet checks yet). A branch-scoped controller edit must NOT touch the
    // customer-level wet-check zone records, otherwise editing a named
    // branch could corrupt an in-progress customer wet check that is keyed
    // off the customer-level (NULL branch) controllers.
    if (typeof patch.zoneCount === "number" && branch === null) {
      const newCount = patch.zoneCount;
      const inProgressIds = await db.select({ id: wetChecks.id }).from(wetChecks)
        .where(and(
          eq(wetChecks.companyId, companyId),
          eq(wetChecks.customerId, customerId),
          eq(wetChecks.status, "in_progress"),
        ));
      const ids = inProgressIds.map(r => r.id);
      if (ids.length > 0) {
        await db.update(wetCheckZoneRecords)
          .set({ status: "not_applicable" })
          .where(and(
            inArray(wetCheckZoneRecords.wetCheckId, ids),
            eq(wetCheckZoneRecords.controllerLetter, letter),
            gt(wetCheckZoneRecords.zoneNumber, newCount),
          ));
      }
    }
    return updated;
  }

  async listCustomerControllersOverview(companyId: number): Promise<Array<{
    customer: Customer;
    branches: Array<{ branchName: string | null; controllers: PropertyController[] }>;
  }>> {
    const custs = await db.select().from(customers)
      .where(and(
        eq(customers.companyId, companyId),
        sql`coalesce(${customers.hiddenFromBilling}, false) = false`,
      ))
      .orderBy(customers.name);
    if (custs.length === 0) return [];
    // First pass: seed any declared branch that doesn't yet have a row in
    // property_controllers. Per task #312, a freshly added branch should
    // appear with one controller (A) at the default zone count so the admin
    // sees a sensible starting state and can immediately bump the count.
    {
      const existingPairs = await db.select({
        customerId: propertyControllers.customerId,
        branchName: propertyControllers.branchName,
      }).from(propertyControllers)
        .where(and(
          eq(propertyControllers.companyId, companyId),
          inArray(propertyControllers.customerId, custs.map(c => c.id)),
        ));
      const seenByCustomer = new Map<number, Set<string>>();
      for (const p of existingPairs) {
        const set = seenByCustomer.get(p.customerId) ?? new Set<string>();
        set.add(p.branchName ?? "");
        seenByCustomer.set(p.customerId, set);
      }
      for (const c of custs) {
        const declared = (c.branches ?? []).filter((b): b is string => typeof b === "string" && b.length > 0);
        if (declared.length === 0) continue;
        const seen = seenByCustomer.get(c.id) ?? new Set<string>();
        for (const branchName of declared) {
          if (!seen.has(branchName)) {
            await this.ensurePropertyControllers(companyId, c.id, 1, branchName);
          }
        }
      }
    }
    const ctrls = await db.select().from(propertyControllers)
      .where(and(
        eq(propertyControllers.companyId, companyId),
        inArray(propertyControllers.customerId, custs.map(c => c.id)),
      ))
      .orderBy(propertyControllers.controllerLetter);
    // Group: customerId -> (branchKey -> rows). Use "" as a stable Map key
    // for the NULL branch and convert back to null on the way out.
    const byCust = new Map<number, Map<string, PropertyController[]>>();
    for (const c of ctrls) {
      const branchKey = c.branchName ?? "";
      let perBranch = byCust.get(c.customerId);
      if (!perBranch) { perBranch = new Map(); byCust.set(c.customerId, perBranch); }
      const arr = perBranch.get(branchKey) ?? [];
      arr.push(c);
      perBranch.set(branchKey, arr);
    }
    return custs.map(customer => {
      const perBranch = byCust.get(customer.id) ?? new Map<string, PropertyController[]>();
      const declaredBranches = (customer.branches ?? []).filter((b): b is string => typeof b === "string" && b.length > 0);
      // Always include the customer-level (NULL) bucket if it has rows OR
      // the customer has no declared branches at all (so the page renders
      // the original single-row UX). For branch customers, also include a
      // row per declared branch even if empty so the admin can fill it in.
      const orderedBranches: Array<{ branchName: string | null; controllers: PropertyController[] }> = [];
      const customerLevelRows = perBranch.get("") ?? [];
      if (customerLevelRows.length > 0 || declaredBranches.length === 0) {
        orderedBranches.push({ branchName: null, controllers: customerLevelRows });
      }
      for (const b of declaredBranches) {
        orderedBranches.push({ branchName: b, controllers: perBranch.get(b) ?? [] });
      }
      // Per task #312: only branches currently declared on the customer
      // record (plus the customer-level NULL bucket) are shown. Rows in
      // property_controllers tied to a branch that has been removed from
      // customers.branches are intentionally hidden here so deleting a
      // branch on the customer profile makes the matching sub-row
      // disappear from this admin page.
      return { customer, branches: orderedBranches };
    });
  }

  async setCustomerControllerCount(
    companyId: number,
    customerId: number,
    count: number,
    opts?: { confirmDeleteWithZones?: boolean; branchName?: string | null },
  ): Promise<{ customer: Customer; controllers: PropertyController[]; removedLetters: string[] }> {
    if (!Number.isInteger(count) || count < 1 || count > 26) {
      throw new Error("Controller count must be between 1 and 26");
    }
    const branch = this.branchKey(opts?.branchName);
    const [customer] = await db.select().from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)));
    if (!customer) throw new Error("Customer not found");

    const allExisting = await this.listPropertyControllers(companyId, customerId);
    const existing = allExisting.filter(c => (c.branchName ?? null) === branch);
    // Determine which letters belong to the new size and which fall outside.
    const keepLetters = new Set<string>();
    for (let i = 0; i < count; i++) {
      keepLetters.add(String.fromCharCode("A".charCodeAt(0) + i));
    }
    const toRemove = existing.filter(c => !keepLetters.has(c.controllerLetter));
    const removedLetters = toRemove.map(c => c.controllerLetter).sort();

    if (toRemove.length > 0) {
      const withZones = toRemove.filter(c => (c.zoneCount ?? 0) > 0).map(c => c.controllerLetter);
      if (withZones.length > 0 && !opts?.confirmDeleteWithZones) {
        throw new ControllerHasZonesError(withZones.sort());
      }
      // Mirror the shrink behaviour from updatePropertyController: mark zone
      // records on in-progress wet checks for the removed letters as not
      // applicable so the field UI doesn't keep checking phantom controllers.
      // Wet-check capture is still customer-level (per task scope), so we
      // only do this for the customer-level (NULL) branch — branch-level
      // edits don't affect any wet-check zone records yet.
      if (branch === null) {
        const inProgressIds = await db.select({ id: wetChecks.id }).from(wetChecks)
          .where(and(
            eq(wetChecks.companyId, companyId),
            eq(wetChecks.customerId, customerId),
            eq(wetChecks.status, "in_progress"),
          ));
        const ids = inProgressIds.map(r => r.id);
        if (ids.length > 0) {
          await db.update(wetCheckZoneRecords)
            .set({ status: "not_applicable" })
            .where(and(
              inArray(wetCheckZoneRecords.wetCheckId, ids),
              inArray(wetCheckZoneRecords.controllerLetter, removedLetters),
            ));
        }
      }
      await db.delete(propertyControllers).where(and(
        eq(propertyControllers.companyId, companyId),
        eq(propertyControllers.customerId, customerId),
        this.branchEq(branch),
        inArray(propertyControllers.controllerLetter, removedLetters),
      ));
    }

    // Add any missing letters up to the new count (default zoneCount = 100).
    await this.ensurePropertyControllers(companyId, customerId, count, branch);

    // customers.totalControllers is a customer-level field; only mirror the
    // count there for customer-level edits. Branch counts live solely on
    // the property_controllers rows.
    let updatedCustomer: Customer | undefined;
    if (branch === null) {
      const [u] = await db.update(customers)
        .set({ totalControllers: count })
        .where(and(eq(customers.id, customerId), eq(customers.companyId, companyId)))
        .returning();
      updatedCustomer = u;
    }
    const refreshed = await this.listPropertyControllers(companyId, customerId);
    const controllers = refreshed.filter(c => (c.branchName ?? null) === branch);
    return { customer: updatedCustomer ?? customer, controllers, removedLetters };
  }

  async listWetChecks(companyId: number, opts?: { status?: string; technicianId?: number }): Promise<WetCheck[]> {
    const conds = [eq(wetChecks.companyId, companyId)];
    if (opts?.status) conds.push(eq(wetChecks.status, opts.status));
    if (opts?.technicianId) conds.push(eq(wetChecks.technicianId, opts.technicianId));
    return await db.select().from(wetChecks).where(and(...conds)).orderBy(desc(wetChecks.startedAt)).limit(200);
  }

  async listWetChecksForAdmin(
    companyId: number,
    opts?: { status?: string },
  ): Promise<Array<WetCheck & { zoneRecordCount: number; findingCount: number; photoCount: number }>> {
    const conds = [eq(wetChecks.companyId, companyId)];
    if (opts?.status) conds.push(eq(wetChecks.status, opts.status));
    // Admin list is the canonical "show every wet check" surface for
    // company admins (used to find and delete records). Returning the
    // full set avoids silently hiding older rows; callers narrow the
    // result with the status filter and the client-side search box.
    const wcs = await db.select().from(wetChecks)
      .where(and(...conds))
      .orderBy(desc(wetChecks.startedAt));
    if (wcs.length === 0) return [];
    const ids = wcs.map(w => w.id);

    // Per-wet-check counts via three small grouped queries; cheaper than
    // joining and de-duplicating in app code.
    const zoneRows = await db.select({
      wetCheckId: wetCheckZoneRecords.wetCheckId,
      n: sql<number>`count(*)::int`,
    }).from(wetCheckZoneRecords)
      .where(inArray(wetCheckZoneRecords.wetCheckId, ids))
      .groupBy(wetCheckZoneRecords.wetCheckId);
    const findingRows = await db.select({
      wetCheckId: wetCheckFindings.wetCheckId,
      n: sql<number>`count(*)::int`,
    }).from(wetCheckFindings)
      .where(inArray(wetCheckFindings.wetCheckId, ids))
      .groupBy(wetCheckFindings.wetCheckId);
    const photoRows = await db.select({
      wetCheckId: wetCheckPhotos.wetCheckId,
      n: sql<number>`count(*)::int`,
    }).from(wetCheckPhotos)
      .where(inArray(wetCheckPhotos.wetCheckId, ids))
      .groupBy(wetCheckPhotos.wetCheckId);

    const zoneMap = new Map(zoneRows.map(r => [r.wetCheckId, Number(r.n)]));
    const findingMap = new Map(findingRows.map(r => [r.wetCheckId, Number(r.n)]));
    const photoMap = new Map(photoRows.map(r => [r.wetCheckId, Number(r.n)]));

    return wcs.map(wc => ({
      ...wc,
      zoneRecordCount: zoneMap.get(wc.id) ?? 0,
      findingCount: findingMap.get(wc.id) ?? 0,
      photoCount: photoMap.get(wc.id) ?? 0,
    }));
  }

  async deleteWetCheck(id: number, companyId: number): Promise<boolean> {
    // Scope-check first so a cross-company id leaks no information.
    await this.assertWetCheckBelongsToCompany(id, companyId);

    // Gather every downstream record produced from this wet check's
    // findings. A finding may route to one of {billing sheet, estimate,
    // work order}. A routed estimate may further have been converted
    // into its own work order (estimates.workOrderId), which is also
    // part of the wet check's downstream chain — we must consider it
    // for both the invoice block and the cascade delete.
    const findings = await db.select({
      billingSheetId: wetCheckFindings.billingSheetId,
      estimateId: wetCheckFindings.estimateId,
      workOrderId: wetCheckFindings.workOrderId,
    }).from(wetCheckFindings).where(eq(wetCheckFindings.wetCheckId, id));
    const billingSheetIds = Array.from(new Set(
      findings.map(f => f.billingSheetId).filter((v): v is number => v != null)));
    const directEstimateIds = Array.from(new Set(
      findings.map(f => f.estimateId).filter((v): v is number => v != null)));
    const directWorkOrderIds = new Set<number>(
      findings.map(f => f.workOrderId).filter((v): v is number => v != null));

    // Pull estimate rows so we can a) know each estimate's display number
    // for blocker messages and b) discover any work order chained off a
    // routed estimate.
    const estimateRows = directEstimateIds.length > 0
      ? await db.select({
          id: estimates.id,
          estimateNumber: estimates.estimateNumber,
          workOrderId: estimates.workOrderId,
        }).from(estimates).where(inArray(estimates.id, directEstimateIds))
      : [];
    for (const e of estimateRows) {
      if (e.workOrderId != null) directWorkOrderIds.add(e.workOrderId);
    }
    const workOrderIds = Array.from(directWorkOrderIds);

    // Resolve invoice linkage for each downstream record. Mirrors the
    // checks deleteBillingSheet runs (billing_sheets.invoiceId or any
    // invoice_items.billingSheetId), with the equivalent for work
    // orders (work_orders.invoiceId or invoice_items.workOrderId).
    //
    // NOTE on `kind: "estimate"` blockers: estimates have no invoiceId
    // column and `invoice_items` has no estimateId column (see shared/
    // schema.ts). The only path an estimate row can reach an invoice is
    // via the work order it was converted into (estimates.workOrderId).
    // That work order is already promoted into `workOrderIds` above and
    // covered by the work-order block below, so we never emit a
    // `kind: "estimate"` blocker. The route + UI accept "estimate" in the
    // contract for forward-compat (e.g. if a direct estimate→invoice link
    // is ever added), but today this branch is intentionally empty.
    const blockers: WetCheckInvoiceBlocker[] = [];

    // Billing sheet blockers
    const bsRows = billingSheetIds.length > 0
      ? await db.select({
          id: billingSheets.id,
          billingNumber: billingSheets.billingNumber,
          invoiceId: billingSheets.invoiceId,
        }).from(billingSheets).where(inArray(billingSheets.id, billingSheetIds))
      : [];
    const bsItemRows = billingSheetIds.length > 0
      ? await db.select({
          billingSheetId: invoiceItems.billingSheetId,
          invoiceId: invoiceItems.invoiceId,
        }).from(invoiceItems).where(inArray(invoiceItems.billingSheetId, billingSheetIds))
      : [];
    const bsItemInvoiceByBs = new Map<number, number | null>();
    for (const r of bsItemRows) {
      if (r.billingSheetId == null) continue;
      if (!bsItemInvoiceByBs.has(r.billingSheetId)) {
        bsItemInvoiceByBs.set(r.billingSheetId, r.invoiceId ?? null);
      }
    }
    for (const bs of bsRows) {
      const linkedInvoiceId = bs.invoiceId ?? bsItemInvoiceByBs.get(bs.id) ?? null;
      if (linkedInvoiceId == null && !bsItemInvoiceByBs.has(bs.id)) continue;
      // Either invoiceId set, or there is at least one matching invoice_item
      let invoiceNumber: string | null = null;
      if (linkedInvoiceId != null) {
        const [inv] = await db.select({ invoiceNumber: invoices.invoiceNumber })
          .from(invoices).where(eq(invoices.id, linkedInvoiceId));
        invoiceNumber = inv?.invoiceNumber ?? null;
      }
      blockers.push({
        kind: "billing_sheet",
        id: bs.id,
        displayNumber: bs.billingNumber ?? null,
        invoiceId: linkedInvoiceId,
        invoiceNumber,
      });
    }

    // Work order blockers (covers both directly-routed work orders and
    // work orders chained off a routed estimate).
    const woRows = workOrderIds.length > 0
      ? await db.select({
          id: workOrders.id,
          workOrderNumber: workOrders.workOrderNumber,
          invoiceId: workOrders.invoiceId,
        }).from(workOrders).where(inArray(workOrders.id, workOrderIds))
      : [];
    const woItemRows = workOrderIds.length > 0
      ? await db.select({
          workOrderId: invoiceItems.workOrderId,
          invoiceId: invoiceItems.invoiceId,
        }).from(invoiceItems).where(inArray(invoiceItems.workOrderId, workOrderIds))
      : [];
    const woItemInvoiceByWo = new Map<number, number | null>();
    for (const r of woItemRows) {
      if (r.workOrderId == null) continue;
      if (!woItemInvoiceByWo.has(r.workOrderId)) {
        woItemInvoiceByWo.set(r.workOrderId, r.invoiceId ?? null);
      }
    }
    for (const wo of woRows) {
      const linkedInvoiceId = wo.invoiceId ?? woItemInvoiceByWo.get(wo.id) ?? null;
      if (linkedInvoiceId == null && !woItemInvoiceByWo.has(wo.id)) continue;
      let invoiceNumber: string | null = null;
      if (linkedInvoiceId != null) {
        const [inv] = await db.select({ invoiceNumber: invoices.invoiceNumber })
          .from(invoices).where(eq(invoices.id, linkedInvoiceId));
        invoiceNumber = inv?.invoiceNumber ?? null;
      }
      blockers.push({
        kind: "work_order",
        id: wo.id,
        displayNumber: wo.workOrderNumber ?? null,
        invoiceId: linkedInvoiceId,
        invoiceNumber,
      });
    }

    if (blockers.length > 0) {
      // Sort for stable, predictable message ordering (kind then id).
      blockers.sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
      throw new WetCheckHasInvoicedRecordsError(id, blockers);
    }

    // Snapshot every photo URL across the wet check AND every downstream
    // record we are about to delete, so the object-storage cleanup pass
    // below has a stable list even after the rows are gone. Done before
    // the transaction so a transient storage failure can't roll back the
    // DB.
    const wcPhotoRows = await db.select({ url: wetCheckPhotos.url })
      .from(wetCheckPhotos).where(eq(wetCheckPhotos.wetCheckId, id));
    const downstreamPhotoUrls: string[] = [];
    if (billingSheetIds.length > 0) {
      const rows = await db.select({ photos: billingSheets.photos })
        .from(billingSheets).where(inArray(billingSheets.id, billingSheetIds));
      for (const r of rows) for (const u of (r.photos ?? [])) if (u) downstreamPhotoUrls.push(u);
    }
    if (estimateRows.length > 0) {
      const rows = await db.select({ photos: estimates.photos, attachments: estimates.attachments })
        .from(estimates).where(inArray(estimates.id, estimateRows.map(e => e.id)));
      for (const r of rows) {
        for (const u of (r.photos ?? [])) if (u) downstreamPhotoUrls.push(u);
        for (const u of (r.attachments ?? [])) if (u) downstreamPhotoUrls.push(u);
      }
    }
    if (workOrderIds.length > 0) {
      const rows = await db.select({ photos: workOrders.photos, attachments: workOrders.attachments })
        .from(workOrders).where(inArray(workOrders.id, workOrderIds));
      for (const r of rows) {
        for (const u of (r.photos ?? [])) if (u) downstreamPhotoUrls.push(u);
        for (const u of (r.attachments ?? [])) if (u) downstreamPhotoUrls.push(u);
      }
    }

    // Single transaction so a partial cascade can't strand orphan rows.
    // Order matters because of FKs:
    //   1. Wet-check children whose FKs point AT the downstream records
    //      (wet_check_photos.findingId, wet_check_findings.{billingSheetId,
    //      estimateId, workOrderId}, wet_check_zone_records). We delete
    //      these first so removing the downstream rows below can't trip
    //      a wet-check-side FK.
    //   2. Work-order children → work orders. Done before estimates because
    //      work_orders.estimateId references estimates.
    //   3. Estimate children → estimates.
    //   4. Billing-sheet children → billing sheets.
    //   5. Wet check row itself.
    const ok = await db.transaction(async (tx) => {
      await tx.delete(wetCheckPhotos).where(eq(wetCheckPhotos.wetCheckId, id));
      await tx.delete(wetCheckFindings).where(eq(wetCheckFindings.wetCheckId, id));
      await tx.delete(wetCheckZoneRecords).where(eq(wetCheckZoneRecords.wetCheckId, id));

      if (workOrderIds.length > 0) {
        await tx.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, workOrderIds));
        await tx.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
      }
      if (estimateRows.length > 0) {
        const estIds = estimateRows.map(e => e.id);
        await tx.delete(estimateItems).where(inArray(estimateItems.estimateId, estIds));
        // quickbooks_sync.estimateId is ON DELETE CASCADE, so no explicit
        // delete needed here — it falls away with the estimate row.
        await tx.delete(estimates).where(inArray(estimates.id, estIds));
      }
      if (billingSheetIds.length > 0) {
        await tx.delete(manualPartReviews)
          .where(inArray(manualPartReviews.billingSheetId, billingSheetIds));
        await tx.delete(billingSheetItems)
          .where(inArray(billingSheetItems.billingSheetId, billingSheetIds));
        await tx.delete(billingSheets).where(inArray(billingSheets.id, billingSheetIds));
      }

      const result = await tx.delete(wetChecks)
        .where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId)));
      return (result.rowCount ?? 0) > 0;
    });

    if (ok) {
      // Best-effort blob cleanup (thumb / medium / original / heic-cache /
      // base) for every photo attached to the deleted wet check AND every
      // photo on the deleted downstream records. Failures are logged
      // inside deletePhotoBlobs and never bubble up — the DB is already
      // consistent at this point.
      const allUrls = [...wcPhotoRows.map(p => p.url), ...downstreamPhotoUrls].filter(Boolean);
      if (allUrls.length > 0) {
        const objectStorage = new ObjectStorageService();
        await Promise.all(allUrls.map(u => objectStorage.deletePhotoBlobs(u)));
      }
    }
    return ok;
  }

  // Inbox aggregate for the manager review surface. Returns every
  // 'submitted' wet check together with its findings-by-issueGroup count
  // and a server-computed total estimated billable amount (using the
  // customer's laborRate snapshot at read time). The UI uses this to
  // render the per-row summary chips without doing N+1 fetches.
  async listWetChecksPendingReview(companyId: number): Promise<Array<WetCheck & {
    findingCounts: { quick_fix: number; advanced: number; zone_issue: number; total: number };
    totalBillable: string;
    customerLaborRate: string;
    autoBilledCount: number;
    autoBilledTotal: string;
    pendingCount: number;
    pendingTotal: string;
  }>> {
    // Queue is status-based by default (Slice 2 behavior). With Slice 3's
    // WET_CHECK_AUTO_BILL flag ON we additionally narrow the result to
    // wet checks that have at least one finding still needing manager
    // attention (resolution=pending OR a non-pending finding without a
    // convertedAt stamp), so all-auto-billed wet checks correctly drop
    // out of the queue. With the flag OFF we restore the original
    // status-only filter so flag-off behavior is identical to Slice 2.
    const autoBillEnabled = process.env.WET_CHECK_AUTO_BILL !== "false";
    const wcs = await db.select().from(wetChecks).where(and(
      eq(wetChecks.companyId, companyId),
      inArray(wetChecks.status, ["submitted", "approved", "partially_converted"]),
    )).orderBy(desc(wetChecks.submittedAt)).limit(200);
    if (wcs.length === 0) return [];
    const ids = wcs.map(w => w.id);
    const findings = await db.select().from(wetCheckFindings)
      .where(inArray(wetCheckFindings.wetCheckId, ids));
    let filteredWcs = wcs;
    if (autoBillEnabled) {
      const needsAttention = (f: WetCheckFinding) =>
        f.resolution === "pending" || f.convertedAt == null;
      const needsAttentionByWc = new Map<number, boolean>();
      for (const f of findings) {
        if (needsAttention(f)) needsAttentionByWc.set(f.wetCheckId, true);
      }
      // Spec wording: queue membership requires "at least one finding
      // where (resolution=pending OR convertedAt IS NULL)". Zero-finding
      // wet checks therefore drop off the queue; with no findings to
      // route, there's nothing for the manager to act on.
      filteredWcs = wcs.filter(w => needsAttentionByWc.get(w.id) === true);
      if (filteredWcs.length === 0) return [];
    }
    // Reuse the already-fetched findings; just narrow the customer
    // resolution to the surviving wet checks.
    const customerIds = Array.from(new Set(filteredWcs.map(w => w.customerId)));
    const custs = await db.select().from(customers).where(inArray(customers.id, customerIds));
    const rateByCustomer = new Map<number, number>();
    for (const c of custs) rateByCustomer.set(c.id, parseFloat(String(c.laborRate ?? "45")));

    const findingsByWc = new Map<number, WetCheckFinding[]>();
    for (const f of findings) {
      const arr = findingsByWc.get(f.wetCheckId) ?? [];
      arr.push(f);
      findingsByWc.set(f.wetCheckId, arr);
    }

    return filteredWcs.map(wc => {
      const fs = findingsByWc.get(wc.id) ?? [];
      const counts = { quick_fix: 0, advanced: 0, zone_issue: 0, total: fs.length };
      const rate = rateByCustomer.get(wc.customerId) ?? 45;
      let billable = 0;
      // Per-resolution breakdown for the manager inbox card pills:
      //   - autoBilled = findings already auto-routed to a billing sheet
      //     (repaired_in_field, the only resolution that creates billable
      //     work without further manager input).
      //   - pending = findings still awaiting a routing decision.
      let autoBilledCount = 0;
      let autoBilledTotal = 0;
      let pendingCount = 0;
      let pendingTotal = 0;
      for (const f of fs) {
        const g = (f.issueGroup as keyof typeof counts) ?? "advanced";
        if (g === "quick_fix" || g === "advanced" || g === "zone_issue") counts[g]++;
        const partPrice = parseFloat(String(f.partPrice ?? 0));
        const qty = Number(f.quantity ?? 0);
        const laborHours = parseFloat(String(f.laborHours ?? 0));
        const lineTotal = partPrice * qty + laborHours * rate;
        // Total estimated billable spans the two monetised buckets:
        // repaired_in_field (→ billing sheet) and sent_to_estimate.
        // 'pending' findings are included so the manager can see the
        // upper-bound shape of the visit before deciding routing.
        const isMonetised =
          f.resolution === "repaired_in_field" ||
          f.resolution === "sent_to_estimate" ||
          f.resolution === "pending";
        if (isMonetised) billable += lineTotal;
        if (f.resolution === "repaired_in_field") {
          autoBilledCount++;
          autoBilledTotal += lineTotal;
        } else if (!f.resolution || f.resolution === "pending") {
          pendingCount++;
          pendingTotal += lineTotal;
        }
      }
      return {
        ...wc,
        findingCounts: counts,
        totalBillable: billable.toFixed(2),
        customerLaborRate: rate.toFixed(2),
        autoBilledCount,
        autoBilledTotal: autoBilledTotal.toFixed(2),
        pendingCount,
        pendingTotal: pendingTotal.toFixed(2),
      };
    });
  }

  async getWetCheckStatusForFinding(findingId: number, companyId: number): Promise<string | null> {
    const [row] = await db.select({ status: wetChecks.status })
      .from(wetCheckFindings)
      .innerJoin(wetChecks, eq(wetChecks.id, wetCheckFindings.wetCheckId))
      .where(and(
        eq(wetCheckFindings.id, findingId),
        eq(wetChecks.companyId, companyId),
      ));
    return row?.status ?? null;
  }

  async getWetCheck(id: number, companyId: number): Promise<WetCheckWithDetails | undefined> {
    const [wc] = await db.select().from(wetChecks)
      .where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId)));
    if (!wc) return undefined;
    const zoneRecords = await db.select().from(wetCheckZoneRecords)
      .where(eq(wetCheckZoneRecords.wetCheckId, id))
      .orderBy(wetCheckZoneRecords.controllerLetter, wetCheckZoneRecords.zoneNumber);
    const findings = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, id));
    const photos = await db.select().from(wetCheckPhotos)
      .where(eq(wetCheckPhotos.wetCheckId, id))
      .orderBy(desc(wetCheckPhotos.takenAt));
    const findingsByZone = new Map<number, WetCheckFinding[]>();
    for (const f of findings) {
      const list = findingsByZone.get(f.zoneRecordId) ?? [];
      list.push(f);
      findingsByZone.set(f.zoneRecordId, list);
    }
    return {
      ...wc,
      zoneRecords: zoneRecords.map(zr => ({ ...zr, findings: findingsByZone.get(zr.id) ?? [] })),
      photos,
    };
  }

  async findActiveWetCheck(companyId: number, customerId: number, technicianId: number): Promise<WetCheck | undefined> {
    const [wc] = await db.select().from(wetChecks).where(and(
      eq(wetChecks.companyId, companyId),
      eq(wetChecks.customerId, customerId),
      eq(wetChecks.technicianId, technicianId),
      eq(wetChecks.status, "in_progress"),
    )).orderBy(desc(wetChecks.startedAt)).limit(1);
    return wc;
  }

  async createWetCheck(insert: InsertWetCheck): Promise<WetCheck> {
    if (insert.clientId) {
      // Scope dedupe to the same company to prevent any chance of a colliding
      // clientId returning another tenant's wet check.
      const [existing] = await db.select().from(wetChecks).where(and(
        eq(wetChecks.clientId, insert.clientId),
        eq(wetChecks.companyId, insert.companyId),
      ));
      if (existing) return existing;
    }
    const [created] = await db.insert(wetChecks).values(insert).returning();
    return created;
  }

  async updateWetCheck(id: number, companyId: number, patch: Partial<InsertWetCheck>): Promise<WetCheck | undefined> {
    // Internal callers (submitWetCheck → set status=submitted, approve, convert)
    // also funnel through here, so we must NOT enforce the editable-by-tech
    // guard when the patch is a system-managed status transition. Only block
    // user-driven edits (e.g. notes/weather/numControllers) once the wet
    // check has left in_progress.
    const isStatusTransition =
      patch.status !== undefined ||
      patch.submittedAt !== undefined ||
      patch.approvedAt !== undefined ||
      patch.fullyConvertedAt !== undefined;
    if (!isStatusTransition) {
      await this.assertWetCheckEditableByTech(id, companyId);
    }
    const [updated] = await db.update(wetChecks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId)))
      .returning();
    return updated;
  }

  async submitWetCheck(id: number, companyId: number): Promise<{
    wetCheck: WetCheck;
    billingSheetId: number | null;
    autoBilledCount: number;
    pendingCount: number;
  } | undefined> {
    const wc0 = await this.assertWetCheckBelongsToCompany(id, companyId);

    // Idempotency: re-submitting a wet check that's already been processed
    // is a no-op. POST /submit accepts an optional clientId for offline
    // retries; status-based dedupe covers all post-submit states because
    // a wet check can only legitimately leave in_progress once via submit.
    if (wc0.status !== "in_progress") {
      const fs = await db.select().from(wetCheckFindings)
        .where(eq(wetCheckFindings.wetCheckId, id));
      const priorBsId = fs.find(f => f.billingSheetId != null)?.billingSheetId ?? null;
      const pendingCount = fs.filter(f => f.resolution === "pending").length;
      return { wetCheck: wc0, billingSheetId: priorBsId, autoBilledCount: 0, pendingCount };
    }

    return await db.transaction(async (tx) => {
      const [wc] = await tx.select().from(wetChecks)
        .where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId)));
      if (!wc) throw new Error(`Wet check ${id} not found for company ${companyId}`);

      // Submit guard: at least one zone must have been actively checked
      // (YES or NO). N/A and not_checked alone do not count.
      const [{ activeCount }] = await tx.select({
        activeCount: sql<number>`COUNT(*)::int`,
      }).from(wetCheckZoneRecords).where(and(
        eq(wetCheckZoneRecords.wetCheckId, id),
        inArray(wetCheckZoneRecords.status, ["checked_ok", "checked_with_issues"]),
      ));
      if (Number(activeCount ?? 0) === 0) {
        throw new Error("Cannot submit a wet check with zero zones checked");
      }

      // Auto-mark any existing 'not_checked' zone records as not_applicable.
      await tx.update(wetCheckZoneRecords)
        .set({ status: "not_applicable" })
        .where(and(eq(wetCheckZoneRecords.wetCheckId, id), eq(wetCheckZoneRecords.status, "not_checked")));

      // Implicit N/A: for every (controller letter × zoneNumber 1..zoneCount)
      // pair that has NO zone record on this wet check, insert one as N/A so
      // the manager review sees an explicit row for every zone in scope.
      const ctrls = await tx.select().from(propertyControllers).where(and(
        eq(propertyControllers.companyId, companyId),
        eq(propertyControllers.customerId, wc.customerId),
      ));
      const existing = await tx.select({
        letter: wetCheckZoneRecords.controllerLetter,
        zone: wetCheckZoneRecords.zoneNumber,
      }).from(wetCheckZoneRecords).where(eq(wetCheckZoneRecords.wetCheckId, id));
      const seen = new Set(existing.map(r => `${r.letter}#${r.zone}`));
      const toInsert: InsertWetCheckZoneRecord[] = [];
      const expectedLetters: string[] = Array.from({ length: wc.numControllers }, (_, i) =>
        String.fromCharCode("A".charCodeAt(0) + i),
      );
      for (const letter of expectedLetters) {
        const ctrl = ctrls.find(c => c.controllerLetter === letter);
        const zoneCount = ctrl?.zoneCount ?? 100;
        for (let z = 1; z <= zoneCount; z++) {
          if (!seen.has(`${letter}#${z}`)) {
            toInsert.push({
              wetCheckId: id,
              controllerLetter: letter,
              zoneNumber: z,
              status: "not_applicable",
            } as InsertWetCheckZoneRecord);
          }
        }
      }
      if (toInsert.length > 0) {
        await tx.insert(wetCheckZoneRecords).values(toInsert).onConflictDoNothing();
      }

      // Slice 3 — Tech-driven auto-billing on submit (gated by
      // WET_CHECK_AUTO_BILL feature flag, default ON). Findings the tech
      // marked "Mark Complete" (resolution=repaired_in_field) auto-flow
      // into a billing sheet inside this same submit transaction. Wet
      // checks with no remaining pending findings skip the manager queue
      // entirely (status=converted). Mixed wet checks land in the queue
      // with the auto-billed slice already locked and only the pending
      // findings actionable.
      const autoBillEnabled = process.env.WET_CHECK_AUTO_BILL !== "false";

      const allFindings = await tx.select().from(wetCheckFindings)
        .where(eq(wetCheckFindings.wetCheckId, id));
      const repaired = allFindings.filter(f =>
        f.resolution === "repaired_in_field" &&
        f.convertedAt == null &&
        f.billingSheetId == null,
      );
      const pendingCount = allFindings.filter(f => f.resolution === "pending").length;

      const now = new Date();
      let billingSheetId: number | null = null;
      let autoBilledCount = 0;

      if (autoBillEnabled && repaired.length > 0) {
        const [cust] = await tx.select().from(customers).where(eq(customers.id, wc.customerId));
        if (!cust) throw new Error(`Customer ${wc.customerId} not found`);
        const laborRate = parseFloat(String(cust.laborRate ?? "45.00"));
        billingSheetId = await this._writeRepairedInFieldBilling(
          tx, wc, laborRate, repaired, /* priorBsId */ null, now,
        );
        autoBilledCount = repaired.length;
      }

      // Determine final status. With WET_CHECK_AUTO_BILL OFF, mirror
      // Slice 2 exactly: every submit lands in 'submitted' regardless of
      // findings shape (no skip-the-queue, no auto-conversion, even when
      // there are zero findings). With the flag ON, status is driven by
      // the post-write convertedAt stamps (auto-bill counts the
      // repaired_in_field findings as converted), so all-converted →
      // 'converted', partial → 'partially_converted', none → 'submitted'.
      let newStatus: "submitted" | "partially_converted" | "converted";
      if (!autoBillEnabled) {
        newStatus = "submitted";
      } else {
        const finalFindings = await tx.select().from(wetCheckFindings)
          .where(eq(wetCheckFindings.wetCheckId, id));
        const totalFindings = finalFindings.length;
        const convertedFindings = finalFindings.filter(f => f.convertedAt != null).length;
        const remainingFindings = totalFindings - convertedFindings;
        if (totalFindings === 0 || remainingFindings === 0) {
          newStatus = "converted";
        } else if (convertedFindings > 0) {
          newStatus = "partially_converted";
        } else {
          newStatus = "submitted";
        }
      }

      const [updated] = await tx.update(wetChecks).set({
        status: newStatus,
        submittedAt: now,
        fullyConvertedAt: newStatus === "converted" ? now : null,
        updatedAt: now,
      }).where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId))).returning();

      return { wetCheck: updated, billingSheetId, autoBilledCount, pendingCount };
    });
  }

  async previewWetCheckSubmit(id: number, companyId: number): Promise<{
    autoBillEnabled: boolean;
    autoBilledCount: number;
    autoBilledPartsTotal: string;
    autoBilledLaborTotal: string;
    autoBilledGrandTotal: string;
    pendingCount: number;
    pendingByGroup: { quick_fix: number; advanced: number; zone_issue: number };
  } | undefined> {
    const wc = await this.assertWetCheckBelongsToCompany(id, companyId);
    const autoBillEnabled = process.env.WET_CHECK_AUTO_BILL !== "false";
    const [cust] = await db.select().from(customers).where(eq(customers.id, wc.customerId));
    const laborRate = parseFloat(String(cust?.laborRate ?? "45.00"));
    const findings = await db.select().from(wetCheckFindings)
      .where(eq(wetCheckFindings.wetCheckId, id));

    const repaired = findings.filter(f =>
      f.resolution === "repaired_in_field" &&
      f.convertedAt == null &&
      f.billingSheetId == null,
    );
    let partsTotal = 0;
    let laborTotal = 0;
    if (autoBillEnabled) {
      for (const f of repaired) {
        const qty = Number(f.quantity ?? 0);
        const partPrice = parseFloat(String(f.partPrice ?? "0"));
        const laborHours = parseFloat(String(f.laborHours ?? "0"));
        partsTotal += partPrice * qty;
        laborTotal += laborHours * laborRate;
      }
    }
    const pendingByGroup = { quick_fix: 0, advanced: 0, zone_issue: 0 };
    let pendingCount = 0;
    for (const f of findings) {
      if (f.resolution !== "pending") continue;
      pendingCount++;
      const g = (f.issueGroup as keyof typeof pendingByGroup) ?? "advanced";
      if (g === "quick_fix" || g === "advanced" || g === "zone_issue") {
        pendingByGroup[g]++;
      }
    }
    return {
      autoBillEnabled,
      autoBilledCount: autoBillEnabled ? repaired.length : 0,
      autoBilledPartsTotal: partsTotal.toFixed(2),
      autoBilledLaborTotal: laborTotal.toFixed(2),
      autoBilledGrandTotal: (partsTotal + laborTotal).toFixed(2),
      pendingCount,
      pendingByGroup,
    };
  }

  // Writes the "repaired in field" billing sheet for a wet check inside an
  // existing transaction. Shared by submitWetCheck (Slice 3 auto-bill) and
  // convertWetCheck (manager-driven conversion). Honours the prior-sheet
  // snapshot rate so previously billed lines are never repriced when the
  // customer's labor rate changes between partial-conversion runs. Stamps
  // findings with billingSheetId + convertedAt and returns the sheet id.
  private async _writeRepairedInFieldBilling(
    tx: DbExecutor,
    wc: WetCheck,
    customerLaborRate: number,
    repaired: WetCheckFinding[],
    priorBsId: number | null,
    now: Date,
  ): Promise<number> {
    // Slice 3 — guard required billing inputs BEFORE writing anything.
    // Any "Mark Complete" finding missing the bits needed to produce a
    // valid billing line must abort the whole submit so the surrounding
    // transaction rolls back. Spec calls out the missing-part case
    // explicitly; we extend the same guard to non-positive quantity
    // (qty * price would zero the line) and negative labor hours.
    for (const f of repaired) {
      if (f.partId == null) {
        throw new Error(
          `Cannot auto-bill finding ${f.id}: marked complete but has no part assigned. ` +
          `Add a part before submitting, or leave Mark Complete unchecked to route to the manager.`,
        );
      }
      const qty = Number(f.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`Cannot auto-bill finding ${f.id}: quantity must be > 0 (got ${f.quantity}).`);
      }
      const laborHours = parseFloat(String(f.laborHours ?? "0"));
      if (!Number.isFinite(laborHours) || laborHours < 0) {
        throw new Error(`Cannot auto-bill finding ${f.id}: laborHours must be >= 0 (got ${f.laborHours}).`);
      }
    }
    const lines = repaired.map(f => {
      const qty = Number(f.quantity);
      const partPrice = parseFloat(String(f.partPrice ?? "0"));
      const laborHours = parseFloat(String(f.laborHours ?? "0"));
      const partsTotal = partPrice * qty;
      return { qty, partPrice, laborHours, partsTotal };
    });
    const newPartsSubtotal = lines.reduce((s, l) => s + l.partsTotal, 0);
    const newLaborHours = lines.reduce((s, l) => s + l.laborHours, 0);

    let bsId: number;
    if (priorBsId != null) {
      // Append to existing wet-check billing sheet and recompute totals
      // from (existing items + new items). The labor rate used here is
      // the SNAPSHOT (`appliedLaborRate`) stored on the existing sheet,
      // NOT the live customer rate — previously converted findings must
      // never be repriced if the customer's labor rate changes between
      // partial-conversion runs.
      const [priorBs] = await tx.select().from(billingSheets)
        .where(eq(billingSheets.id, priorBsId));
      const snapshotRate = parseFloat(String(priorBs?.appliedLaborRate ?? priorBs?.laborRate ?? customerLaborRate));
      const existingItems = await tx.select().from(billingSheetItems)
        .where(eq(billingSheetItems.billingSheetId, priorBsId));
      const existingPartsSubtotal = existingItems.reduce(
        (s, it) => s + parseFloat(String(it.totalPrice ?? "0")), 0);
      const existingLaborHours = existingItems.reduce(
        (s, it) => s + parseFloat(String(it.laborHours ?? "0")), 0);
      const totalLaborHours = existingLaborHours + newLaborHours;
      const partsSubtotal = existingPartsSubtotal + newPartsSubtotal;
      const laborSubtotal = totalLaborHours * snapshotRate;
      const total = partsSubtotal + laborSubtotal;
      await tx.update(billingSheets).set({
        totalHours: totalLaborHours.toFixed(2),
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: partsSubtotal.toFixed(2),
        totalAmount: total.toFixed(2),
      }).where(eq(billingSheets.id, priorBsId));
      bsId = priorBsId;
    } else {
      const laborSubtotal = newLaborHours * customerLaborRate;
      const total = newPartsSubtotal + laborSubtotal;
      const billingNumber = `BS-WC-${wc.id}-${Date.now()}`;
      const [bs] = await tx.insert(billingSheets).values({
        billingNumber,
        customerId: wc.customerId,
        customerName: wc.customerName,
        propertyAddress: wc.propertyAddress ?? "",
        workDate: wc.submittedAt ?? now,
        technicianName: wc.technicianName,
        technicianId: wc.technicianId,
        workDescription: `Wet check repairs (#${wc.id})`,
        status: "submitted",
        totalHours: newLaborHours.toFixed(2),
        laborRate: customerLaborRate.toFixed(2),
        laborSubtotal: laborSubtotal.toFixed(2),
        partsSubtotal: newPartsSubtotal.toFixed(2),
        totalAmount: total.toFixed(2),
        appliedLaborRate: customerLaborRate.toFixed(2),
      } as typeof billingSheets.$inferInsert).returning();
      bsId = bs.id;
    }

    for (let i = 0; i < repaired.length; i++) {
      const f = repaired[i];
      const l = lines[i];
      await tx.insert(billingSheetItems).values({
        billingSheetId: bsId,
        partId: f.partId,
        partName: f.partName ?? f.issueType,
        partDescription: f.notes ?? null,
        quantity: l.qty.toFixed(2),
        unitPrice: l.partPrice.toFixed(2),
        totalPrice: l.partsTotal.toFixed(2),
        laborHours: l.laborHours.toFixed(2),
        notes: f.notes ?? null,
      });
      await tx.update(wetCheckFindings).set({
        billingSheetId: bsId,
        convertedAt: now,
        updatedAt: now,
      }).where(eq(wetCheckFindings.id, f.id));
    }
    return bsId;
  }

  private async assertWetCheckBelongsToCompany(wetCheckId: number, companyId: number): Promise<WetCheck> {
    const [wc] = await db.select().from(wetChecks)
      .where(and(eq(wetChecks.id, wetCheckId), eq(wetChecks.companyId, companyId)));
    if (!wc) throw new Error(`Wet check ${wetCheckId} not found for company ${companyId}`);
    return wc;
  }

  // Approve-lock: tech-side edits are only permitted while the wet check is
  // still in_progress. Once it is submitted (or beyond), only the manager
  // routing/convert endpoints may mutate it. The single exception is
  // updateWetCheckFinding, which uses assertFindingPriceEditable below to
  // additionally allow manager pricing edits while the wet check is
  // 'submitted' but not yet 'approved'.
  private async assertWetCheckEditableByTech(wetCheckId: number, companyId: number): Promise<WetCheck> {
    const wc = await this.assertWetCheckBelongsToCompany(wetCheckId, companyId);
    if (wc.status !== "in_progress") {
      throw new Error(`Wet check ${wetCheckId} is ${wc.status}; only in-progress wet checks can be edited`);
    }
    return wc;
  }

  // Wet-check-level edit window. Per-finding immutability for already-
  // converted rows is enforced via the convertedAt/FK check below.
  private async assertFindingPriceEditable(wetCheckId: number, companyId: number): Promise<WetCheck> {
    const wc = await this.assertWetCheckBelongsToCompany(wetCheckId, companyId);
    if (wc.status !== "in_progress" && wc.status !== "submitted" && wc.status !== "partially_converted") {
      throw new Error(`Wet check ${wetCheckId} is ${wc.status}; finding pricing is locked`);
    }
    return wc;
  }

  async upsertWetCheckZoneRecord(
    wetCheckId: number,
    companyId: number,
    insert: InsertWetCheckZoneRecord,
  ): Promise<WetCheckZoneRecord> {
    await this.assertWetCheckEditableByTech(wetCheckId, companyId);
    if (insert.clientId) {
      // Scope dedupe to this wet check (already verified to belong to this
      // company) so a colliding clientId from another tenant cannot return
      // a foreign zone record.
      const [byClient] = await db.select().from(wetCheckZoneRecords).where(and(
        eq(wetCheckZoneRecords.clientId, insert.clientId),
        eq(wetCheckZoneRecords.wetCheckId, wetCheckId),
      ));
      if (byClient) return byClient;
    }
    const [byNatural] = await db.select().from(wetCheckZoneRecords).where(and(
      eq(wetCheckZoneRecords.wetCheckId, wetCheckId),
      eq(wetCheckZoneRecords.controllerLetter, insert.controllerLetter),
      eq(wetCheckZoneRecords.zoneNumber, insert.zoneNumber),
    ));
    if (byNatural) {
      const [updated] = await db.update(wetCheckZoneRecords)
        .set({ ...insert, wetCheckId })
        .where(eq(wetCheckZoneRecords.id, byNatural.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(wetCheckZoneRecords).values({ ...insert, wetCheckId }).returning();
    return created;
  }

  async updateWetCheckZoneRecord(
    id: number,
    companyId: number,
    patch: Partial<InsertWetCheckZoneRecord>,
  ): Promise<WetCheckZoneRecord | undefined> {
    const [zr] = await db.select().from(wetCheckZoneRecords).where(eq(wetCheckZoneRecords.id, id));
    if (!zr) return undefined;
    await this.assertWetCheckEditableByTech(zr.wetCheckId, companyId);
    const [updated] = await db.update(wetCheckZoneRecords).set(patch).where(eq(wetCheckZoneRecords.id, id)).returning();
    return updated;
  }

  async createWetCheckFinding(
    zoneRecordId: number,
    companyId: number,
    insert: Omit<InsertWetCheckFinding, "zoneRecordId" | "wetCheckId" | "issueGroup">,
  ): Promise<WetCheckFinding> {
    const [zr] = await db.select().from(wetCheckZoneRecords).where(eq(wetCheckZoneRecords.id, zoneRecordId));
    if (!zr) throw new Error(`Zone record ${zoneRecordId} not found`);
    await this.assertWetCheckEditableByTech(zr.wetCheckId, companyId);

    if (insert.clientId) {
      // Scope dedupe to this zone record's wet check (already verified above
      // to belong to this company) so a foreign tenant cannot collide.
      const [existing] = await db.select().from(wetCheckFindings).where(and(
        eq(wetCheckFindings.clientId, insert.clientId),
        eq(wetCheckFindings.wetCheckId, zr.wetCheckId),
      ));
      if (existing) return existing;
    }

    // Snapshot part name + price at finding-creation time. The parts lookup
    // is scoped to this company so a client cannot reference (or snapshot) a
    // part belonging to another tenant. When a partId is provided, server-
    // authoritative snapshot ALWAYS overrides any client-supplied partName /
    // partPrice — clients cannot smuggle a manipulated price into the
    // finding row.
    let partName = insert.partName ?? null;
    let partPrice = insert.partPrice ?? null;
    if (insert.partId) {
      const [p] = await db.select().from(parts).where(and(
        eq(parts.id, insert.partId),
        eq(parts.companyId, companyId),
      ));
      if (!p) throw new Error(`Part ${insert.partId} not found in this company`);
      partName = p.name;
      partPrice = p.price;
    }

    const issueGroup = deriveIssueGroup(insert.issueType);
    const [created] = await db.insert(wetCheckFindings).values({
      ...insert,
      zoneRecordId,
      wetCheckId: zr.wetCheckId,
      issueGroup,
      partName,
      partPrice,
    } as InsertWetCheckFinding).returning();

    // Bump zone status when a finding lands on a zone marked checked_ok.
    if (zr.status === "checked_ok" || zr.status === "not_checked") {
      await db.update(wetCheckZoneRecords)
        .set({ status: "checked_with_issues" })
        .where(eq(wetCheckZoneRecords.id, zoneRecordId));
    }
    return created;
  }

  async updateWetCheckFinding(
    id: number,
    companyId: number,
    patch: Partial<InsertWetCheckFinding>,
  ): Promise<WetCheckFinding | undefined> {
    const [f] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, id));
    if (!f) return undefined;
    // Editable while wet check is in_progress (tech) OR submitted (manager
    // pricing/part swap during review). Beyond that — approved, partially
    // or fully converted — pricing rows are frozen.
    await this.assertFindingPriceEditable(f.wetCheckId, companyId);
    const isConverted =
      f.convertedAt != null ||
      f.billingSheetId != null ||
      f.estimateId != null ||
      f.workOrderId != null;
    if (isConverted) {
      // Once converted, the entire finding row is sealed (not just pricing).
      // Routing changes go through the separate /route endpoint which
      // enforces its own immutability check.
      throw new Error(`Finding ${id} is already converted; the row is immutable`);
    }
    // If a new partId is being set on the finding, verify it belongs to this
    // company AND server-authoritatively overwrite the snapshot fields so a
    // client cannot smuggle a manipulated partName / partPrice during edit.
    const next: Partial<InsertWetCheckFinding> = { ...patch, updatedAt: new Date() } as Partial<InsertWetCheckFinding>;
    if (patch.partId != null) {
      const [p] = await db.select().from(parts).where(and(
        eq(parts.id, patch.partId as number),
        eq(parts.companyId, companyId),
      ));
      if (!p) throw new Error(`Part ${patch.partId} not found in this company`);
      next.partName = p.name;
      next.partPrice = p.price;
    }
    if (patch.issueType) next.issueGroup = deriveIssueGroup(patch.issueType);
    const [updated] = await db.update(wetCheckFindings).set(next).where(eq(wetCheckFindings.id, id)).returning();
    return updated;
  }

  async deleteWetCheckFinding(id: number, companyId: number): Promise<boolean> {
    const [f] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, id));
    if (!f) return false;
    await this.assertWetCheckEditableByTech(f.wetCheckId, companyId);
    if (f.resolution !== "pending") return false;
    const result = await db.delete(wetCheckFindings).where(eq(wetCheckFindings.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async attachWetCheckPhoto(
    wetCheckId: number,
    companyId: number,
    insert: Omit<InsertWetCheckPhoto, "wetCheckId">,
  ): Promise<WetCheckPhoto> {
    await this.assertWetCheckEditableByTech(wetCheckId, companyId);
    // Cross-record linkage validation: a photo's optional zoneRecordId /
    // findingId must belong to the SAME wet check, otherwise a client could
    // attach a photo to a record from a different visit (and tenant
    // ownership of those records is implicitly enforced because the wet
    // check itself was just verified to belong to this company).
    if (insert.zoneRecordId != null) {
      const [zr] = await db.select().from(wetCheckZoneRecords).where(eq(wetCheckZoneRecords.id, insert.zoneRecordId));
      if (!zr || zr.wetCheckId !== wetCheckId) {
        throw new Error(`Zone record ${insert.zoneRecordId} does not belong to wet check ${wetCheckId}`);
      }
    }
    if (insert.findingId != null) {
      const [fd] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, insert.findingId));
      if (!fd || fd.wetCheckId !== wetCheckId) {
        throw new Error(`Finding ${insert.findingId} does not belong to wet check ${wetCheckId}`);
      }
    }
    if (insert.clientId) {
      // Scope dedupe to the same wet check (already verified to belong to
      // this company) so a colliding clientId from another tenant cannot
      // surface a foreign photo row.
      const [existing] = await db.select().from(wetCheckPhotos).where(and(
        eq(wetCheckPhotos.clientId, insert.clientId),
        eq(wetCheckPhotos.wetCheckId, wetCheckId),
      ));
      if (existing) return existing;
    }
    const [created] = await db.insert(wetCheckPhotos).values({ ...insert, wetCheckId }).returning();
    return created;
  }

  async deleteWetCheckPhoto(id: number, companyId: number): Promise<boolean> {
    const [p] = await db.select().from(wetCheckPhotos).where(eq(wetCheckPhotos.id, id));
    if (!p) return false;
    await this.assertWetCheckEditableByTech(p.wetCheckId, companyId);
    const result = await db.delete(wetCheckPhotos).where(eq(wetCheckPhotos.id, id));
    const ok = (result.rowCount ?? 0) > 0;
    if (ok) {
      // Best-effort blob cleanup (thumb / medium / original / heic-cache /
      // base) so deleting a single photo doesn't leak its files in object
      // storage. Mirrors the bulk cleanup in deleteWetCheck.
      const objectStorage = new ObjectStorageService();
      await objectStorage.deletePhotoBlobs(p.url);
    }
    return ok;
  }

  async linkWetCheckPhotoToFinding(
    photoId: number,
    findingId: number,
    companyId: number,
  ): Promise<WetCheckPhoto | undefined> {
    const [p] = await db.select().from(wetCheckPhotos).where(eq(wetCheckPhotos.id, photoId));
    if (!p) return undefined;
    await this.assertWetCheckEditableByTech(p.wetCheckId, companyId);
    const [f] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, findingId));
    if (!f || f.wetCheckId !== p.wetCheckId) {
      throw new Error(`Finding ${findingId} does not belong to wet check ${p.wetCheckId}`);
    }
    const [updated] = await db
      .update(wetCheckPhotos)
      .set({ findingId, zoneRecordId: f.zoneRecordId })
      .where(eq(wetCheckPhotos.id, photoId))
      .returning();
    return updated;
  }

  async approveWetCheck(
    id: number,
    companyId: number,
    manager: { id: number; name: string },
  ): Promise<WetCheck | undefined> {
    const wc = await this.assertWetCheckBelongsToCompany(id, companyId);
    if (wc.status !== "submitted" && wc.status !== "approved") {
      throw new Error(`Cannot approve wet check in status ${wc.status}`);
    }
    const [updated] = await db.update(wetChecks)
      .set({
        status: "approved",
        approvedAt: wc.approvedAt ?? new Date(),
        approvedBy: manager.id,
        approvedByName: manager.name,
        updatedAt: new Date(),
      })
      .where(eq(wetChecks.id, id))
      .returning();
    return updated;
  }

  async routeWetCheckFinding(
    id: number,
    companyId: number,
    resolution: "pending" | "repaired_in_field" | "sent_to_estimate" | "deferred_to_work_order" | "documented_only",
    manager: { id: number; name: string },
  ): Promise<WetCheckFinding | undefined> {
    const [f] = await db.select().from(wetCheckFindings).where(eq(wetCheckFindings.id, id));
    if (!f) return undefined;
    const wc = await this.assertWetCheckBelongsToCompany(f.wetCheckId, companyId);
    // Manager routing only makes sense once the field tech has handed off
    // (submitted / approved / partially_converted). Block in_progress so a
    // race during tech edit cannot flip routing, and block converted so a
    // fully-routed wet check stays sealed.
    if (wc.status !== "submitted" && wc.status !== "approved" && wc.status !== "partially_converted") {
      throw new Error(`Wet check ${f.wetCheckId} is ${wc.status}; routing is locked`);
    }
    // documented_only findings have convertedAt but no FK, so check both.
    const isConverted =
      f.convertedAt != null ||
      f.billingSheetId != null ||
      f.estimateId != null ||
      f.workOrderId != null;
    if (isConverted) {
      throw new Error(`Finding ${id} is already converted; routing is immutable`);
    }
    const [updated] = await db.update(wetCheckFindings).set({
      resolution,
      resolutionDecidedAt: resolution === "pending" ? null : new Date(),
      resolutionDecidedBy: resolution === "pending" ? null : manager.id,
      updatedAt: new Date(),
    }).where(eq(wetCheckFindings.id, id)).returning();
    return updated;
  }

  async convertWetCheck(
    id: number,
    companyId: number,
    manager: { id: number; name: string },
    scheduledDates: Record<number, string | null> = {},
  ): Promise<{
    wetCheck: WetCheck;
    billingSheetId: number | null;
    estimateId: number | null;
    workOrderId: number | null;
  }> {
    return await db.transaction(async (tx) => {
      const [wc] = await tx.select().from(wetChecks)
        .where(and(eq(wetChecks.id, id), eq(wetChecks.companyId, companyId)));
      if (!wc) throw new Error(`Wet check ${id} not found for company ${companyId}`);
      if (wc.status !== "submitted" && wc.status !== "approved" && wc.status !== "partially_converted") {
        throw new Error(`Cannot convert wet check in status ${wc.status}`);
      }
      const [cust] = await tx.select().from(customers).where(eq(customers.id, wc.customerId));
      if (!cust) throw new Error(`Customer ${wc.customerId} not found`);
      const laborRate = parseFloat(String(cust.laborRate ?? "45.00"));

      const allFindings = await tx.select().from(wetCheckFindings)
        .where(eq(wetCheckFindings.wetCheckId, id));
      // Eligible = routed AND not already converted. documented_only rows
      // have no FK so we must also gate on convertedAt or repeated converts
      // would re-stamp/re-process them (idempotency bug).
      const eligible = allFindings.filter(f =>
        f.resolution !== "pending" &&
        f.convertedAt == null &&
        f.billingSheetId == null && f.estimateId == null && f.workOrderId == null,
      );
      const repaired = eligible.filter(f => f.resolution === "repaired_in_field");
      const sentEst = eligible.filter(f => f.resolution === "sent_to_estimate");
      const deferred = eligible.filter(f => f.resolution === "deferred_to_work_order");
      const documented = eligible.filter(f => f.resolution === "documented_only");

      const calc = (f: typeof allFindings[number]) => {
        const qty = Number(f.quantity);
        const partPrice = parseFloat(String(f.partPrice ?? "0"));
        const laborHours = parseFloat(String(f.laborHours ?? "0"));
        const partsTotal = partPrice * qty;
        const laborTotal = laborHours * laborRate;
        return { qty, partPrice, laborHours, partsTotal, laborTotal, lineTotal: partsTotal + laborTotal };
      };

      const now = new Date();
      // Reuse destinations created on a prior partial conversion of THIS
      // wet check so we satisfy the "at most one BS / one estimate / one WO
      // per wet check lifecycle" invariant. Subsequent runs append items
      // to the existing record and recompute its totals instead of
      // creating a duplicate.
      const priorBsId = allFindings.find(f => f.billingSheetId != null)?.billingSheetId ?? null;
      const priorEstId = allFindings.find(f => f.estimateId != null)?.estimateId ?? null;
      const priorWoId = allFindings.find(f => f.workOrderId != null)?.workOrderId ?? null;
      let billingSheetId: number | null = priorBsId;
      let estimateId: number | null = priorEstId;
      let workOrderId: number | null = priorWoId;

      // 1) Repaired-in-field → at most one billing sheet per wet check.
      // Shared helper with submitWetCheck (Slice 3 auto-bill) keeps both
      // paths writing identical billing-sheet shapes.
      if (repaired.length > 0) {
        billingSheetId = await this._writeRepairedInFieldBilling(
          tx, wc, laborRate, repaired, priorBsId, now,
        );
      }

      // 2) Sent-to-estimate → at most one estimate per wet check
      if (sentEst.length > 0) {
        for (const f of sentEst) {
          if (!f.partId) {
            throw new Error(`Finding ${f.id} cannot be sent to estimate without a part`);
          }
        }
        let estId: number;
        if (priorEstId != null) {
          // Append items to the existing wet-check estimate, then recompute
          // totals from (existing items + new items). Use the SNAPSHOT
          // appliedLaborRate from the existing estimate so prior items
          // are not repriced. estimate-item `totalPrice` is parts-only
          // (partPrice * qty) per processEstimatePayload convention.
          const [priorEst] = await tx.select().from(estimates)
            .where(eq(estimates.id, priorEstId));
          const snapshotRate = parseFloat(String(priorEst?.appliedLaborRate ?? priorEst?.laborRate ?? laborRate));
          const existingItems = await tx.select().from(estimateItems)
            .where(eq(estimateItems.estimateId, priorEstId));
          let nextSort = existingItems.reduce((m, it) => Math.max(m, it.sortOrder ?? 0), -1) + 1;
          for (const f of sentEst) {
            const c = calc(f);
            await tx.insert(estimateItems).values({
              estimateId: priorEstId,
              description: f.notes ?? f.issueType,
              partId: f.partId as number,
              partName: f.partName ?? f.issueType,
              partPrice: c.partPrice.toFixed(2),
              laborHours: c.laborHours.toFixed(2),
              quantity: c.qty,
              totalPrice: c.partsTotal.toFixed(2),
              sortOrder: nextSort++,
            } as typeof estimateItems.$inferInsert);
          }
          const allItems = await tx.select().from(estimateItems)
            .where(eq(estimateItems.estimateId, priorEstId));
          const partsSubtotal = allItems.reduce(
            (s, it) => s + parseFloat(String(it.totalPrice ?? "0")), 0);
          const totalLaborHours = allItems.reduce(
            (s, it) => s + parseFloat(String(it.laborHours ?? "0")), 0);
          const laborSubtotal = totalLaborHours * snapshotRate;
          const total = partsSubtotal + laborSubtotal;
          await tx.update(estimates).set({
            partsSubtotal: partsSubtotal.toFixed(2),
            laborSubtotal: laborSubtotal.toFixed(2),
            totalAmount: total.toFixed(2),
            updatedAt: now,
          }).where(eq(estimates.id, priorEstId));
          estId = priorEstId;
        } else {
          // First-time creation goes through the SAME service POST
          // /api/estimates uses, keeping any side effects in lock-step.
          const estimateNumber = `EST-WC-${id}-${Date.now()}`;
          const est = await this.createEstimateFromPayload({
            estimate: {
              companyId,
              customerId: wc.customerId,
              customerName: cust.name,
              customerEmail: cust.email,
              customerPhone: cust.phone ?? null,
              projectName: `Wet check follow-up (#${id})`,
              projectAddress: wc.propertyAddress ?? null,
              createdBy: manager.name,
              createdByUserId: manager.id,
              estimateDate: now,
              status: "pending",
              laborRate: laborRate.toFixed(2),
              appliedLaborRate: laborRate.toFixed(2),
            } as EstimatePayloadInput["estimate"],
            items: sentEst.map((f, idx) => {
              const c = calc(f);
              return {
                description: f.notes ?? f.issueType,
                partId: f.partId as number,
                partName: f.partName ?? f.issueType,
                partPrice: c.partPrice.toFixed(2),
                // Finding labor is line-level (calc does not multiply by qty);
                // estimate-item convention is also line-level.
                laborHours: c.laborHours.toFixed(2),
                quantity: c.qty,
                sortOrder: idx,
              };
            }),
          }, tx, estimateNumber);
          estId = est.id;
        }
        estimateId = estId;
        for (const f of sentEst) {
          await tx.update(wetCheckFindings).set({
            estimateId: estId,
            convertedAt: now,
            updatedAt: now,
          }).where(eq(wetCheckFindings.id, f.id));
        }
      }

      // 3) Deferred-to-work-order → at most one work order per wet check
      if (deferred.length > 0) {
        const lines = deferred.map(calc);
        const newPartsSubtotal = lines.reduce((s, l) => s + l.partsTotal, 0);
        const newLaborHours = lines.reduce((s, l) => s + l.laborHours, 0);
        // Earliest manager-supplied scheduled date wins for the WO header.
        let scheduled: Date | null = null;
        for (const f of deferred) {
          const raw = scheduledDates[f.id];
          if (raw) {
            const d = new Date(raw);
            if (!isNaN(d.getTime()) && (!scheduled || d < scheduled)) scheduled = d;
          }
        }

        let woId: number;
        if (priorWoId != null) {
          // Append items to the existing wet-check WO and recompute totals
          // from the SNAPSHOT appliedLaborRate stored on that WO so prior
          // items are not repriced. WO-item totalPrice mirrors estimate-
          // item convention: parts-only (partPrice * qty).
          const [priorWo] = await tx.select().from(workOrders)
            .where(eq(workOrders.id, priorWoId));
          const snapshotRate = parseFloat(String(priorWo?.appliedLaborRate ?? priorWo?.laborRate ?? laborRate));
          const existingItems = await tx.select().from(workOrderItems)
            .where(eq(workOrderItems.workOrderId, priorWoId));
          for (let i = 0; i < deferred.length; i++) {
            const f = deferred[i];
            const l = lines[i];
            await tx.insert(workOrderItems).values({
              workOrderId: priorWoId,
              partId: f.partId,
              partName: f.partName ?? f.issueType,
              partPrice: l.partPrice.toFixed(2),
              quantity: l.qty,
              laborHours: l.laborHours.toFixed(2),
              totalPrice: l.partsTotal.toFixed(2),
            });
          }
          const existingParts = existingItems.reduce(
            (s, it) => s + parseFloat(String(it.totalPrice ?? "0")), 0);
          const existingLaborHours = existingItems.reduce(
            (s, it) => s + parseFloat(String(it.laborHours ?? "0")), 0);
          const partsSubtotal = existingParts + newPartsSubtotal;
          const totalLaborHours = existingLaborHours + newLaborHours;
          const laborSubtotal = totalLaborHours * snapshotRate;
          const total = partsSubtotal + laborSubtotal;
          await tx.update(workOrders).set({
            totalHours: totalLaborHours.toFixed(2),
            laborSubtotal: laborSubtotal.toFixed(2),
            partsSubtotal: partsSubtotal.toFixed(2),
            totalAmount: total.toFixed(2),
            totalItems: existingItems.length + deferred.length,
            // Only move scheduledDate earlier — never push it later — so a
            // follow-up conversion cannot delay work the manager already
            // committed to. Pass-through if no prior date existed.
            ...(scheduled && (!priorWo?.scheduledDate || scheduled < priorWo.scheduledDate)
              ? { scheduledDate: scheduled }
              : {}),
          }).where(eq(workOrders.id, priorWoId));
          woId = priorWoId;
        } else {
          const laborSubtotal = newLaborHours * laborRate;
          const total = newPartsSubtotal + laborSubtotal;
          const woNumber = `WO-WC-${id}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const wo = await this._writeWorkOrderWithItems(
            tx,
            {
              workOrderNumber: woNumber,
              customerId: wc.customerId,
              customerName: cust.name,
              customerEmail: cust.email,
              customerPhone: cust.phone ?? null,
              projectName: `Wet check deferred work (#${id})`,
              projectAddress: wc.propertyAddress ?? null,
              workType: "maintenance",
              status: "pending",
              priority: "medium",
              scheduledDate: scheduled,
              description: `Deferred from wet check #${id}`,
              totalHours: newLaborHours.toFixed(2),
              laborRate: laborRate.toFixed(2),
              laborSubtotal: laborSubtotal.toFixed(2),
              partsSubtotal: newPartsSubtotal.toFixed(2),
              totalAmount: total.toFixed(2),
              appliedLaborRate: laborRate.toFixed(2),
              totalItems: deferred.length,
            } as typeof workOrders.$inferInsert,
            deferred.map((f, i) => {
              const l = lines[i];
              return {
                partId: f.partId,
                partName: f.partName ?? f.issueType,
                partPrice: l.partPrice.toFixed(2),
                quantity: l.qty,
                laborHours: l.laborHours.toFixed(2),
                // Parts-only line total per estimate/WO item convention
                // (labor is captured at header from laborHours * applied rate).
                totalPrice: l.partsTotal.toFixed(2),
              };
            }),
          );
          woId = wo.id;
        }
        workOrderId = woId;

        for (const f of deferred) {
          await tx.update(wetCheckFindings).set({
            workOrderId: woId,
            convertedAt: now,
            updatedAt: now,
          }).where(eq(wetCheckFindings.id, f.id));
        }
      }

      // 4) Documented-only → stamp convertedAt only (no FK)
      for (const f of documented) {
        await tx.update(wetCheckFindings).set({
          convertedAt: now,
          updatedAt: now,
        }).where(eq(wetCheckFindings.id, f.id));
      }

      // 5) Wet check status: partially_converted if any pending remain.
      const stillPending = await tx.select({ id: wetCheckFindings.id })
        .from(wetCheckFindings)
        .where(and(
          eq(wetCheckFindings.wetCheckId, id),
          eq(wetCheckFindings.resolution, "pending"),
        ));
      const newStatus = stillPending.length > 0 ? "partially_converted" : "converted";
      const [updated] = await tx.update(wetChecks).set({
        status: newStatus,
        fullyConvertedAt: stillPending.length > 0 ? null : now,
        approvedAt: wc.approvedAt ?? now,
        approvedBy: wc.approvedBy ?? manager.id,
        approvedByName: wc.approvedByName ?? manager.name,
        updatedAt: now,
      }).where(eq(wetChecks.id, id)).returning();

      return { wetCheck: updated, billingSheetId, estimateId, workOrderId };
    });
  }
}

export const storage = new DatabaseStorage();