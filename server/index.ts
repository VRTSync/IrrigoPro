import express, { type Request, Response, NextFunction, ErrorRequestHandler } from "express";
import fileUpload from "express-fileupload";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logger, createRequestLogger } from "./logger";
import { db, pool } from "./db";
import { customers, parts, billingSheets, billingSheetItems, users, workOrders, workOrderItems, invoices } from "@shared/schema";
import { ne, eq, inArray, or, and } from "drizzle-orm";

// Optional API Rate Limiting (disabled by default for production compatibility)
interface RateLimitOptions {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

const rateLimitConfig: RateLimitOptions = {
  enabled: process.env.ENABLE_RATE_LIMITING === 'true',
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutes
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000') // 1000 requests per window
};

// In-memory rate limiting store (simple implementation)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!rateLimitConfig.enabled) {
    next();
    return;
  }

  const clientId = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const key = `${clientId}`;
  
  const existing = rateLimitStore.get(key);
  
  if (!existing || now > existing.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + rateLimitConfig.windowMs
    });
    next();
    return;
  }
  
  if (existing.count >= rateLimitConfig.maxRequests) {
    logger.warn(`Rate limit exceeded for ${clientId}`, "Security", {
      requests: existing.count,
      windowMs: rateLimitConfig.windowMs
    });
    res.status(429).json({ 
      message: "Too many requests, please try again later" 
    });
    return;
  }
  
  existing.count++;
  rateLimitStore.set(key, existing);
  next();
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Configure proxy trust for production rate limiting
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Apply rate limiting if enabled (defaults to disabled)
app.use(rateLimitMiddleware);
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  abortOnLimit: true
}));

// Add request logging middleware
app.use(createRequestLogger);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Prevent database connection resets and other transient errors from crashing the server
process.on('unhandledRejection', (reason: any, promise) => {
  const msg = reason?.message || String(reason);
  // Log but don't crash — Neon DB may terminate idle connections; these are recoverable
  console.error('Unhandled promise rejection (non-fatal):', msg);
  logger.error('Unhandled promise rejection', reason instanceof Error ? reason : new Error(msg), 'Server');
});

process.on('uncaughtException', (error: Error) => {
  const msg = error?.message || String(error);
  // DB connection resets are recoverable — log and continue
  if (msg.includes('terminating connection') || msg.includes('Connection terminated') || msg.includes('ECONNRESET')) {
    console.error('Recoverable connection error (continuing):', msg);
    logger.error('Recoverable connection error', error, 'Server');
    return;
  }
  // For truly unrecoverable errors, log and exit
  console.error('Uncaught exception (fatal):', msg);
  logger.error('Uncaught exception (fatal)', error, 'Server');
  process.exit(1);
});

async function runStartupMigrations() {
  try {
    const updated = await db
      .update(customers)
      .set({ taxPercent: '0.00' })
      .where(ne(customers.taxPercent, '0.00'))
      .returning({ id: customers.id });
    if (updated.length > 0) {
      logger.info(`Startup migration: reset ${updated.length} customer(s) to 0.00% tax`, 'Server Startup');
    }
  } catch (err) {
    logger.error('Startup migration error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add branches column to customers table if not already present
  try {
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS branches text[]`);
    logger.info('Startup migration: ensured customers.branches column exists', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: branches column error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add branch_name column to billing_sheets table if not already present
  try {
    await pool.query(`ALTER TABLE billing_sheets ADD COLUMN IF NOT EXISTS branch_name text`);
    logger.info('Startup migration: ensured billing_sheets.branch_name column exists', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: billing_sheets.branch_name column error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add branch_name column to work_orders table if not already present
  try {
    await pool.query(`ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS branch_name text`);
    logger.info('Startup migration: ensured work_orders.branch_name column exists', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: work_orders.branch_name column error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add financial breakdown and applied-rate snapshot columns to work_orders if not present
  try {
    await pool.query(`
      ALTER TABLE work_orders
        ADD COLUMN IF NOT EXISTS markup_amount DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS tax_amount DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS applied_labor_rate DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS applied_markup_rate DECIMAL(5, 4),
        ADD COLUMN IF NOT EXISTS applied_tax_rate DECIMAL(5, 4)
    `);
    logger.info('Startup migration: ensured work_orders financial snapshot columns exist', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: work_orders financial snapshot columns error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add manager approval gate columns to work_orders and billing_sheets
  try {
    await pool.query(`
      ALTER TABLE work_orders
        ADD COLUMN IF NOT EXISTS approved_by text,
        ADD COLUMN IF NOT EXISTS approved_by_user_id integer,
        ADD COLUMN IF NOT EXISTS approved_at timestamptz,
        ADD COLUMN IF NOT EXISTS approved_total DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS approved_parts_snapshot text,
        ADD COLUMN IF NOT EXISTS approved_labor_snapshot text
    `);
    logger.info('Startup migration: ensured work_orders approval stamp columns exist', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: work_orders approval stamp columns error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  try {
    await pool.query(`
      ALTER TABLE billing_sheets
        ADD COLUMN IF NOT EXISTS approved_by text,
        ADD COLUMN IF NOT EXISTS approved_by_user_id integer,
        ADD COLUMN IF NOT EXISTS approved_at timestamptz,
        ADD COLUMN IF NOT EXISTS approved_total DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS approved_parts_snapshot text,
        ADD COLUMN IF NOT EXISTS approved_labor_snapshot text
    `);
    logger.info('Startup migration: ensured billing_sheets approval stamp columns exist', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: billing_sheets approval stamp columns error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add markup_percent column to customers if not present (default 15.00 = 15% parts markup)
  try {
    await pool.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS markup_percent DECIMAL(5, 2) DEFAULT 15.00`);
    logger.info('Startup migration: ensured customers.markup_percent column exists', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: customers.markup_percent column error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Add approval_status and approved_at columns to parts table if not present
  try {
    await pool.query(`
      ALTER TABLE parts
        ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved',
        ADD COLUMN IF NOT EXISTS approved_at timestamp
    `);
    logger.info('Startup migration: ensured parts.approval_status and parts.approved_at columns exist', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: parts approval columns error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Ensure manual_part_reviews table exists (created from schema drift)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_part_reviews (
        id serial PRIMARY KEY,
        billing_sheet_id integer REFERENCES billing_sheets(id) NOT NULL,
        billing_sheet_item_id integer REFERENCES billing_sheet_items(id),
        company_id integer REFERENCES companies(id) NOT NULL,
        part_name text NOT NULL,
        proposed_price numeric(10, 2) NOT NULL,
        reviewed_price numeric(10, 2),
        approval_status text NOT NULL DEFAULT 'pending',
        approved_at timestamp,
        created_at timestamp NOT NULL DEFAULT NOW()
      )
    `);
    logger.info('Startup migration: ensured manual_part_reviews table exists', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: manual_part_reviews table error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Health assertion: verify critical parts columns exist and are readable; log explicit error if drift detected
  try {
    const driftCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'parts'
        AND column_name IN ('approval_status', 'approved_at')
    `);
    const found = driftCheck.rows.map((r: { column_name: string }) => r.column_name);
    const missing = ['approval_status', 'approved_at'].filter(c => !found.includes(c));
    if (missing.length > 0) {
      logger.error(
        `STARTUP HEALTH CHECK FAILED: parts table is missing columns: ${missing.join(', ')}. The /api/parts endpoint will return 500 errors until these columns are added.`,
        new Error(`Schema drift detected: missing columns ${missing.join(', ')}`),
        'Server Startup'
      );
    } else {
      logger.info('Startup health check: parts table schema OK (approval_status, approved_at present)', 'Server Startup');
    }
  } catch (err) {
    logger.error('Startup health check: could not verify parts table schema (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // QB2: Add metadata columns and unique constraint on realm_id to quickbooks_integration
  try {
    // Add metadata columns if not present
    await pool.query(`
      ALTER TABLE quickbooks_integration
        ADD COLUMN IF NOT EXISTS last_refresh_attempt TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_refresh_success TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_refresh_failure TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS connection_status TEXT NOT NULL DEFAULT 'connected',
        ADD COLUMN IF NOT EXISTS reconnect_required_reason TEXT,
        ADD COLUMN IF NOT EXISTS token_environment TEXT NOT NULL DEFAULT 'sandbox'
    `);
    // Deduplicate by realm_id before adding the unique constraint: keep most recently updated row per realm_id
    await pool.query(`
      DELETE FROM quickbooks_integration
      WHERE id NOT IN (
        SELECT DISTINCT ON (realm_id) id
        FROM quickbooks_integration
        ORDER BY realm_id, updated_at DESC NULLS LAST, id DESC
      )
    `);
    // Create unique index on realm_id if it doesn't exist
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quickbooks_integration_realm_id_unique
        ON quickbooks_integration (realm_id)
    `);
    logger.info('Startup migration: ensured quickbooks_integration metadata columns and realm_id unique constraint exist', 'Server Startup');
  } catch (err) {
    logger.error('Startup migration: quickbooks_integration QB2 migration error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  const MIGRATION_KEY = 'billing-sheets-sync-rates-v1';

  try {
    // Ensure a persistent app_settings table exists for tracking one-time migrations
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Check if this migration has already completed
    const existingRow = await pool.query(
      'SELECT value FROM app_settings WHERE key = $1',
      [MIGRATION_KEY]
    );
    if (existingRow.rows.length > 0 && existingRow.rows[0].value === 'completed') {
      logger.info(`Startup migration '${MIGRATION_KEY}': already completed, skipping`, 'Server Startup');
      return;
    }

    const allCustomers = await db.select().from(customers);
    const customerRateMap = new Map<number, string>();
    for (const c of allCustomers) {
      customerRateMap.set(c.id, c.laborRate ?? '45.00');
    }

    const allParts = await db.select().from(parts);
    const partPriceMap = new Map<number, string>();
    for (const p of allParts) {
      partPriceMap.set(p.id, p.price);
    }

    const allSheets = await db.select().from(billingSheets);
    const allItems = await db.select().from(billingSheetItems);

    const itemsBySheet = new Map<number, typeof allItems>();
    for (const item of allItems) {
      if (item.billingSheetId === null || item.billingSheetId === undefined) continue;
      const list = itemsBySheet.get(item.billingSheetId) ?? [];
      list.push(item);
      itemsBySheet.set(item.billingSheetId, list);
    }

    let sheetsUpdated = 0;
    let itemsUpdated = 0;

    for (const sheet of allSheets) {
      if (sheet.customerId === null || sheet.customerId === undefined) continue;

      const currentLaborRate = customerRateMap.get(sheet.customerId);
      if (currentLaborRate === undefined) continue;

      const sheetItems = itemsBySheet.get(sheet.id) ?? [];
      let partsSubtotal = 0;
      let itemsChangedOnSheet = 0;

      for (const item of sheetItems) {
        if (item.partId === null || item.partId === undefined) {
          partsSubtotal += parseFloat(item.totalPrice ?? '0');
          continue;
        }

        const currentPrice = partPriceMap.get(item.partId);
        if (currentPrice === undefined) {
          partsSubtotal += parseFloat(item.totalPrice ?? '0');
          continue;
        }

        const qty = parseFloat(item.quantity ?? '0');
        const newTotalPrice = qty * parseFloat(currentPrice);
        const newTotalPriceStr = newTotalPrice.toFixed(2);

        const priceChanged =
          parseFloat(item.unitPrice ?? '0').toFixed(2) !== parseFloat(currentPrice).toFixed(2) ||
          parseFloat(item.totalPrice ?? '0').toFixed(2) !== newTotalPriceStr;

        if (priceChanged) {
          await db
            .update(billingSheetItems)
            .set({
              unitPrice: currentPrice,
              totalPrice: newTotalPriceStr,
            })
            .where(eq(billingSheetItems.id, item.id));

          itemsChangedOnSheet++;
          itemsUpdated++;
        }

        partsSubtotal += newTotalPrice;
      }

      const totalHours = parseFloat(sheet.totalHours ?? '0');
      const newLaborRate = parseFloat(currentLaborRate);
      const newLaborSubtotal = totalHours * newLaborRate;
      const markupAmount = parseFloat(sheet.markupAmount ?? '0');
      const taxAmount = parseFloat(sheet.taxAmount ?? '0');
      const newTotalAmount = newLaborSubtotal + partsSubtotal + markupAmount + taxAmount;

      const sheetChanged =
        parseFloat(sheet.laborRate ?? '0').toFixed(2) !== newLaborRate.toFixed(2) ||
        parseFloat(sheet.laborSubtotal ?? '0').toFixed(2) !== newLaborSubtotal.toFixed(2) ||
        parseFloat(sheet.partsSubtotal ?? '0').toFixed(2) !== partsSubtotal.toFixed(2) ||
        parseFloat(sheet.totalAmount ?? '0').toFixed(2) !== newTotalAmount.toFixed(2) ||
        itemsChangedOnSheet > 0;

      if (sheetChanged) {
        await db
          .update(billingSheets)
          .set({
            laborRate: currentLaborRate,
            laborSubtotal: newLaborSubtotal.toFixed(2),
            partsSubtotal: partsSubtotal.toFixed(2),
            totalAmount: newTotalAmount.toFixed(2),
          })
          .where(eq(billingSheets.id, sheet.id));

        sheetsUpdated++;
      }
    }

    // Persist the migration completion flag atomically
    await pool.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, 'completed', NOW())
       ON CONFLICT (key) DO UPDATE SET value = 'completed', updated_at = NOW()`,
      [MIGRATION_KEY]
    );

    logger.info(
      `Startup migration '${MIGRATION_KEY}': updated ${sheetsUpdated} billing sheet(s) and ${itemsUpdated} item(s) to current rates`,
      'Server Startup'
    );
    console.log(`[Migration] ${MIGRATION_KEY}: ${sheetsUpdated} sheets updated, ${itemsUpdated} items updated`);
  } catch (err) {
    logger.error(
      `Startup migration '${MIGRATION_KEY}' error (non-fatal)`,
      err instanceof Error ? err : new Error(String(err)),
      'Server Startup'
    );
  }

  try {
    const irrigationManagers = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, 'irrigation_manager'));
    if (irrigationManagers.length > 0) {
      const managerIds = irrigationManagers.map((u) => u.id);
      const updated = await db
        .update(billingSheets)
        .set({ status: 'approved' })
        .where(
          and(
            inArray(billingSheets.technicianId, managerIds),
            or(
              eq(billingSheets.status, 'draft'),
              eq(billingSheets.status, 'submitted')
            )
          )
        )
        .returning({ id: billingSheets.id });
      if (updated.length > 0) {
        logger.info(`Startup migration: approved ${updated.length} billing sheet(s) created by irrigation managers`, 'Server Startup');
      }
    }
  } catch (err) {
    logger.error('Startup migration error (irrigation manager billing sheets, non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Recompute zero subtotals for work orders and billing sheets that have line items
  try {
    const toNum = (val: string | number | null | undefined): number => {
      if (val === null || val === undefined) return 0;
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(n) ? 0 : n;
    };

    // Find work orders with zero parts and zero labor subtotals
    const allWorkOrders = await db.select().from(workOrders);
    const affectedInvoiceIds = new Set<number>();
    let woRepaired = 0;

    for (const wo of allWorkOrders) {
      const partsAmt = toNum(wo.partsSubtotal);
      const laborAmt = toNum(wo.laborSubtotal);
      if (partsAmt !== 0 || laborAmt !== 0) continue;

      // Check if this work order has items
      const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, wo.id));
      if (items.length === 0) continue;

      // Compute correct subtotals from totalHours/totalPartsCost (same formula as completion route)
      // Fall back to summing item totalPrices if those fields are also zero
      const totalHoursVal = toNum(wo.totalHours);
      const totalPartsCostVal = toNum(wo.totalPartsCost);
      const laborRateVal = toNum(wo.laborRate) || 45;

      let computedLabor = totalHoursVal * laborRateVal;
      let computedParts = totalPartsCostVal;

      // If those are also zero, sum item prices as best approximation
      if (computedLabor === 0 && computedParts === 0) {
        for (const item of items) {
          const itemParts = toNum(item.partPrice) * toNum(item.quantity);
          const itemLabor = toNum(item.laborHours) * laborRateVal;
          computedParts += itemParts;
          computedLabor += itemLabor;
        }
      }

      const newTotal = computedParts + computedLabor;
      await db.update(workOrders)
        .set({
          partsSubtotal: computedParts.toFixed(2),
          laborSubtotal: computedLabor.toFixed(2),
          totalAmount: newTotal.toFixed(2),
        })
        .where(eq(workOrders.id, wo.id));

      woRepaired++;
      if (wo.invoiceId) affectedInvoiceIds.add(wo.invoiceId);
      logger.info(`Startup migration: repaired work_order id=${wo.id} partsSubtotal=${computedParts.toFixed(2)} laborSubtotal=${computedLabor.toFixed(2)} totalAmount=${newTotal.toFixed(2)}`, 'Server Startup');
    }

    // Find billing sheets with zero parts and zero labor subtotals
    const allSheets2 = await db.select().from(billingSheets);
    let bsRepaired = 0;

    for (const sheet of allSheets2) {
      const partsAmt = toNum(sheet.partsSubtotal);
      const laborAmt = toNum(sheet.laborSubtotal);
      if (partsAmt !== 0 || laborAmt !== 0) continue;

      const sheetItems = await db.select().from(billingSheetItems).where(eq(billingSheetItems.billingSheetId, sheet.id));
      if (sheetItems.length === 0) continue;

      // Compute labor from totalHours * laborRate (same approach as existing billing-sheets migration)
      // Compute parts by summing item totalPrices (items are parts-only; labor is tracked via totalHours)
      const totalHoursVal = toNum(sheet.totalHours);
      const laborRateVal = toNum(sheet.laborRate) || 45;
      const computedLabor = totalHoursVal * laborRateVal;

      // Sum item totalPrices as parts subtotal (billing sheet items are parts, not labor rows)
      let computedParts = 0;
      for (const item of sheetItems) {
        computedParts += toNum(item.totalPrice);
      }

      const markupAmount = toNum(sheet.markupAmount);
      const taxAmount = toNum(sheet.taxAmount);
      const newTotal = computedParts + computedLabor + markupAmount + taxAmount;

      await db.update(billingSheets)
        .set({
          partsSubtotal: computedParts.toFixed(2),
          laborSubtotal: computedLabor.toFixed(2),
          totalAmount: newTotal.toFixed(2),
        })
        .where(eq(billingSheets.id, sheet.id));

      bsRepaired++;
      if (sheet.invoiceId) affectedInvoiceIds.add(sheet.invoiceId);
      logger.info(`Startup migration: repaired billing_sheet id=${sheet.id} partsSubtotal=${computedParts.toFixed(2)} laborSubtotal=${computedLabor.toFixed(2)} totalAmount=${newTotal.toFixed(2)}`, 'Server Startup');
    }

    // Recompute invoice totals for affected invoices
    let invoicesRepaired = 0;
    for (const invoiceId of affectedInvoiceIds) {
      const invoice = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!invoice[0]) continue;

      // Sum work order totals linked to this invoice
      const linkedWorkOrders = await db.select().from(workOrders).where(eq(workOrders.invoiceId, invoiceId));
      const linkedBillingSheets = await db.select().from(billingSheets).where(eq(billingSheets.invoiceId, invoiceId));

      let newPartsSubtotal = 0;
      let newLaborSubtotal = 0;
      for (const wo of linkedWorkOrders) {
        newPartsSubtotal += toNum(wo.partsSubtotal);
        newLaborSubtotal += toNum(wo.laborSubtotal);
      }
      for (const bs of linkedBillingSheets) {
        newPartsSubtotal += toNum(bs.partsSubtotal);
        newLaborSubtotal += toNum(bs.laborSubtotal);
      }

      const markupAmount = toNum(invoice[0].markupAmount);
      const taxAmount = toNum(invoice[0].taxAmount);
      const newTotal = newPartsSubtotal + newLaborSubtotal + markupAmount + taxAmount;

      await db.update(invoices)
        .set({
          partsSubtotal: newPartsSubtotal.toFixed(2),
          laborSubtotal: newLaborSubtotal.toFixed(2),
          totalAmount: newTotal.toFixed(2),
        })
        .where(eq(invoices.id, invoiceId));

      invoicesRepaired++;
      logger.info(`Startup migration: recomputed invoice id=${invoiceId} totalAmount=${newTotal.toFixed(2)}`, 'Server Startup');
    }

    if (woRepaired > 0 || bsRepaired > 0 || invoicesRepaired > 0) {
      logger.info(
        `Startup migration (recompute-zero-subtotals): repaired ${woRepaired} work order(s), ${bsRepaired} billing sheet(s), ${invoicesRepaired} invoice(s)`,
        'Server Startup'
      );
    }
  } catch (err) {
    logger.error('Startup migration (recompute-zero-subtotals) error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Prune truly empty work order items and billing sheet items (no name, no price, no hours, no quantity)
  try {
    const toNum2 = (val: string | number | null | undefined): number => {
      if (val === null || val === undefined) return 0;
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(n) ? 0 : n;
    };

    const allWoItems = await db.select().from(workOrderItems);
    let woItemsPruned = 0;
    for (const item of allWoItems) {
      const hasName = item.partName && item.partName.trim() !== '';
      const hasPrice = toNum2(item.partPrice) !== 0;
      const hasQty = toNum2(item.quantity) !== 0;
      const hasLabor = toNum2(item.laborHours) !== 0;
      if (!hasName && !hasPrice && !hasQty && !hasLabor) {
        await db.delete(workOrderItems).where(eq(workOrderItems.id, item.id));
        woItemsPruned++;
        logger.info(`Startup migration (prune-empty-items): deleted empty work_order_item id=${item.id} workOrderId=${item.workOrderId}`, 'Server Startup');
      }
    }

    const allBsItems = await db.select().from(billingSheetItems);
    let bsItemsPruned = 0;
    for (const item of allBsItems) {
      const hasName = item.partName && item.partName.trim() !== '';
      const hasDescription = item.partDescription && item.partDescription.trim() !== '';
      const hasPrice = toNum2(item.unitPrice) !== 0;
      const hasQty = toNum2(item.quantity) !== 0;
      const hasLabor = toNum2(item.laborHours) !== 0;
      if (!hasName && !hasDescription && !hasPrice && !hasQty && !hasLabor) {
        await db.delete(billingSheetItems).where(eq(billingSheetItems.id, item.id));
        bsItemsPruned++;
        logger.info(`Startup migration (prune-empty-items): deleted empty billing_sheet_item id=${item.id} billingSheetId=${item.billingSheetId}`, 'Server Startup');
      }
    }

    if (woItemsPruned > 0 || bsItemsPruned > 0) {
      logger.info(
        `Startup migration (prune-empty-items): removed ${woItemsPruned} empty work order item(s), ${bsItemsPruned} empty billing sheet item(s)`,
        'Server Startup'
      );
    }
  } catch (err) {
    logger.error('Startup migration (prune-empty-items) error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }

  // Zero out markup/tax amounts on work orders and billing sheets that had non-zero values
  // from per-customer markup/tax rates, and recalculate totalAmount = partsSubtotal + laborSubtotal.
  // Then update invoice totals for invoices built from those corrected records.
  try {
    const toNum3 = (val: string | number | null | undefined): number => {
      if (val === null || val === undefined) return 0;
      const n = typeof val === 'string' ? parseFloat(val) : val;
      return isNaN(n) ? 0 : n;
    };

    const correctedInvoiceIds = new Set<number>();
    let woMarkupFixed = 0;
    let bsMarkupFixed = 0;

    const allWorkOrdersForMarkup = await db.select().from(workOrders);
    for (const wo of allWorkOrdersForMarkup) {
      const markupAmt = toNum3(wo.markupAmount);
      const taxAmt = toNum3(wo.taxAmount);
      if (markupAmt === 0 && taxAmt === 0) continue;

      const correctTotal = toNum3(wo.partsSubtotal) + toNum3(wo.laborSubtotal);
      await db.update(workOrders)
        .set({
          markupAmount: '0.00',
          taxAmount: '0.00',
          appliedMarkupRate: '0.0000',
          appliedTaxRate: '0.0000',
          totalAmount: correctTotal.toFixed(2),
        })
        .where(eq(workOrders.id, wo.id));
      woMarkupFixed++;
      if (wo.invoiceId) correctedInvoiceIds.add(wo.invoiceId);
      logger.info(`Startup migration (zero-markup-tax): corrected work_order id=${wo.id} markupAmount=${markupAmt} taxAmount=${taxAmt} -> totalAmount=${correctTotal.toFixed(2)}`, 'Server Startup');
    }

    const allSheetsForMarkup = await db.select().from(billingSheets);
    for (const sheet of allSheetsForMarkup) {
      const markupAmt = toNum3(sheet.markupAmount);
      const taxAmt = toNum3(sheet.taxAmount);
      if (markupAmt === 0 && taxAmt === 0) continue;

      const correctTotal = toNum3(sheet.partsSubtotal) + toNum3(sheet.laborSubtotal);
      await db.update(billingSheets)
        .set({
          markupAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: correctTotal.toFixed(2),
        })
        .where(eq(billingSheets.id, sheet.id));
      bsMarkupFixed++;
      if (sheet.invoiceId) correctedInvoiceIds.add(sheet.invoiceId);
      logger.info(`Startup migration (zero-markup-tax): corrected billing_sheet id=${sheet.id} markupAmount=${markupAmt} taxAmount=${taxAmt} -> totalAmount=${correctTotal.toFixed(2)}`, 'Server Startup');
    }

    let invoiceMarkupFixed = 0;
    for (const invoiceId of correctedInvoiceIds) {
      const invoice = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
      if (!invoice[0]) continue;

      const linkedWorkOrders = await db.select().from(workOrders).where(eq(workOrders.invoiceId, invoiceId));
      const linkedBillingSheets = await db.select().from(billingSheets).where(eq(billingSheets.invoiceId, invoiceId));

      let newTotal = 0;
      for (const wo of linkedWorkOrders) {
        newTotal += toNum3(wo.partsSubtotal) + toNum3(wo.laborSubtotal);
      }
      for (const bs of linkedBillingSheets) {
        newTotal += toNum3(bs.partsSubtotal) + toNum3(bs.laborSubtotal);
      }

      await db.update(invoices)
        .set({ totalAmount: newTotal.toFixed(2) })
        .where(eq(invoices.id, invoiceId));
      invoiceMarkupFixed++;
      logger.info(`Startup migration (zero-markup-tax): recomputed invoice id=${invoiceId} totalAmount=${newTotal.toFixed(2)}`, 'Server Startup');
    }

    if (woMarkupFixed > 0 || bsMarkupFixed > 0 || invoiceMarkupFixed > 0) {
      logger.info(
        `Startup migration (zero-markup-tax): corrected ${woMarkupFixed} work order(s), ${bsMarkupFixed} billing sheet(s), ${invoiceMarkupFixed} invoice(s)`,
        'Server Startup'
      );
    }
  } catch (err) {
    logger.error('Startup migration (zero-markup-tax) error (non-fatal)', err instanceof Error ? err : new Error(String(err)), 'Server Startup');
  }
}

(async () => {
  logger.info("Starting IrrigoPro server", "Server Startup", {
    environment: process.env.NODE_ENV,
    databaseAvailable: !!process.env.DATABASE_URL,
    version: "1.0.0"
  });
  
  console.log("Starting server...");
  console.log("Node environment:", process.env.NODE_ENV);
  console.log("Database URL available:", !!process.env.DATABASE_URL);

  // Warn if QuickBooks redirect URI is not configured
  if (!process.env.QUICKBOOKS_REDIRECT_URI) {
    console.warn('WARNING: QUICKBOOKS_REDIRECT_URI is not set. QuickBooks OAuth will not work until this is configured.');
  }

  await runStartupMigrations();
  
  let server;
  try {
    server = await registerRoutes(app);
    console.log("Routes registered successfully");
  } catch (error) {
    console.error("Failed to register routes:", error);
    logger.error("Failed to register routes", error, "Server Startup");
    throw error;
  }

  // Error handling middleware must come after route registration
  const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error with full context
    logger.error(
      `Server error: ${message}`,
      err,
      `${req.method} ${req.path}`,
      {
        status,
        userId: (req as any).user?.id,
        requestBody: req.body,
        params: req.params,
        query: req.query
      }
    );

    res.status(status).json({ message });
  };
  
  app.use(errorHandler);



  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  // Validate port configuration
  if (isNaN(port) || port < 1 || port > 65535) {
    const errorMsg = `Invalid port configuration: ${process.env.PORT}. Port must be a number between 1 and 65535.`;
    console.error(errorMsg);
    logger.error(errorMsg, new Error('Invalid port configuration'), 'Server Startup');
    process.exit(1);
  }
  
  // Start server with simplified listen call and error handling
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server successfully started on port ${port}`);
    log(`serving on port ${port}`);
    logger.info(`Server listening on port ${port}`, 'Server Startup', { port, host: '0.0.0.0', environment: process.env.NODE_ENV });
  }).on('error', (err) => {
    console.error('Server failed to start:', err);
    logger.error('Server failed to start', err, 'Server Startup', { port, host: '0.0.0.0' });
    process.exit(1);
  });
})();
