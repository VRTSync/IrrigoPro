# IrrigoPro

A full-stack business management system for irrigation companies, streamlining operations from estimates to billing.

## Run & Operate

- **Run Dev Server**: `npm run dev`
- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **DB Push**: `npm run db:push`
- **Generate Drizzle Migrations**: `npm run db:generate`
- **Required Env Vars**: `DATABASE_URL`, `POSTMARK_API_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_TOKEN`, `QB_REDIRECT_URI`

## Stack

- **Frontend**: React (TypeScript, Vite, shadcn/ui, Tailwind CSS), TanStack React Query, Wouter, React Hook Form (Zod)
- **Backend**: Node.js (Express.js), TypeScript
- **Database**: PostgreSQL (Neon Database)
- **ORM**: Drizzle ORM
- **Authentication**: Session-based, TOTP MFA, email verification, phone-based login

## Where things live

- `client/`: Frontend application
- `server/`: Backend API and logic
- `drizzle/`: Drizzle ORM migrations
- `server/db/schema.ts`: Database schema
- `server/routes.ts`: API route definitions
- `client/src/components/ui/`: shadcn/ui components
- `client/src/styles/tailwind.css`: Main Tailwind CSS

## Architecture decisions

- **Role-based Pricing Visibility**: Financial data is stripped from API responses for field technicians at the server level.
- **Server-side Pricing Enforcement**: Catalog pricing for line items is enforced server-side for accuracy.
- **Unified Work Order & Billing Sheet UI**: Edit/View modals share a consistent layout for improved user experience.
- **Independent Parts Management**: Parts catalog operates independently from QuickBooks for robust inventory control.
- **KML for Site Maps**: KML import is used for interactive irrigation maps, providing detailed site visualization.
- **IrrigoPro Display Name (`irrigoName`)**: A separate customer field for internal recognition, prominently displayed.

## Product

- Manages estimates, customer approval, work orders, invoicing, and billing sheets.
- Granular role-based access control for pricing, site maps, QuickBooks, customer management, and work orders/billing sheets.
- Interactive site maps with KML import, controller management, and live GPS tracking.
- Token-based customer email approval for estimates.
- Database-driven and PWA push notifications.
- Secure authentication with MFA and phone number-based login.
- External Work Order API for CRM integration.
- Photo uploads for work orders and billing sheets with role-based editing.
- Authoritative pricing and auditing for catalog items and labor rates.
- Location picker with live GPS tracking and "Use My Location" functionality.
- Comprehensive parts catalog access with CRUD permissions for billing and irrigation managers.

## User preferences

Preferred communication style: Simple, everyday language.
Site Map Display Preferences: Default display mode set to solid markers with zone/controller identifiers in the center, enhanced popups with detailed information. Maintain original styling and functionality unless explicitly requested to change.
App Branding: Updated to "IrrigoPro" with professional blue water droplet logo design featuring bright blue (#3B82F6) primary colors, dark gray borders, and light green accent details.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Customer Approval System: Complete email approval workflow with individual estimate status check buttons, proper production domain URLs (irrigopro.com/estimate-approval), and professional customer-facing success pages that avoid admin interface confusion.
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Navigation Improvements: Company admin navigation streamlined to 5 items with improved wording and Admin dropdown containing Team and Company management options for better alignment and organization. Irrigation manager navigation enhanced to include comprehensive business management: Estimates (full estimate system access), Work Orders, Billing Sheets, Customers (with site map viewing), Dashboard, and Parts (with catalog/list dropdown). Mobile navigation optimized for irrigation managers with smart prioritization: ensures access to all key business areas including the complete estimate management system.
Site Map Access Control: Site map viewing (read-only) is available to company administrators, irrigation managers, and field technicians. Complete CRUD operations (create, update, delete) are restricted to company administrators only. All other roles including super admins and billing managers have no access to site maps. Backend API routes are protected with appropriate access control middleware: requireSiteMapViewAccess for viewing operations and requireCompanyAdminAccess for modification operations.
Customer Management Permissions: Role-based access control for customer management. Billing managers can view all customers and edit existing customer details (name, address, contact info, etc.) but cannot create new customers, delete customers, or access the integrations tab. Irrigation managers and field technicians have strict view-only access. Only company admin and super admin users have full privileges including creation, deletion, integrations access, and property notes editing. Frontend UI shows Edit button for billing_manager in the customer list and customer profile, but not Delete, Add Customer, or Integrations tab.
Parts Management Independence: Parts catalog operates independently from QuickBooks integration. Internal parts CRUD system provides complete inventory control without external dependencies. QuickBooks integration removed from parts catalog to ensure reliable operation and reduce complexity.
Production Security: All debug console.log statements removed from customer creation flow. Authentication uses session-based user lookup instead of localStorage for production compatibility. Form validation properly handles missing user data with graceful fallbacks.
Animated Loading Skeletons: Comprehensive loading skeleton system implemented across all major pages (Dashboard, Customers, Work Orders, Estimates, Parts Catalog) with smooth fade-in animations and staggered timing for enhanced user experience during page transitions. All components use production-safe API authentication patterns.
QuickBooks Access Restrictions: Complete QuickBooks access removal implemented for irrigation managers and field technicians. All QuickBooks API endpoints protected with role-based middleware, QuickBooks tab removed from estimates page for restricted roles, and backend routes return 403 access denied errors for unauthorized access attempts. Only company administrators, super administrators, and billing managers have QuickBooks integration access.
Field Tech Pricing Visibility: CRITICAL SECURITY FEATURE - Field technicians NEVER see pricing or money values anywhere in the app. All pricing fields (laborRate, laborSubtotal, partsSubtotal, totalAmount, unitPrice, cost, price, markupAmount, taxAmount, etc.) are automatically stripped from API responses when the user role is field_tech. This is implemented via the applyPricingVisibility() function in server/routes.ts which recursively sanitizes objects and arrays. Applies to work orders, work order items, billing sheets, and parts endpoints. Field techs can see work details and quantities but not any financial data.
Work Order and Billing Sheet Management: Company administrators and billing managers have full edit and delete permissions for work orders and billing sheets. Backend API routes are protected with role-based middleware (requireWorkOrderBillingAccess) ensuring only authorized users can modify or delete these critical business documents. Frontend UI provides Edit and Delete buttons for authorized roles with confirmation dialogs for destructive actions. Billing managers can edit work orders and billing sheets directly from the customer billing review page. EditWorkOrderModal and EditBillingSheetModal are fully redesigned to mirror the CompletedWorkDetailModal view layout — same gradient header, same section cards (Location, Job Info, Time & Labor, Parts & Materials, Photos, Notes, Financial Summary) — but with editable inputs instead of static text. Parts list editing uses a dedicated EditPartsModal sub-modal (client/src/components/billing/edit-parts-modal.tsx) that reuses the PartsSearchModal for library search (search/SKU/popular parts) and allows inline qty/price editing and row removal. Financial totals auto-calculate live as fields are edited.
Parts Catalog Access: Billing managers and irrigation managers have comprehensive parts catalog access with full CRUD permissions. This includes viewing all parts with pricing information, creating and editing individual parts, advanced filtering and search, and QuickBooks integration for parts sync. Bulk import functionality is restricted to company administrators and super administrators only. Additionally, irrigation managers have access to both the full Parts Catalog and a simplified Parts List view through a dropdown navigation menu, providing flexibility for different use cases. The parts catalog provides extensive inventory management capabilities for all management-level personnel while maintaining appropriate permission controls.
Work Order & Billing Sheet Photo Uploads: Photos can be attached during work order and billing sheet creation via the FileUpload component. Uploaded photos are stored in the `photos` array field (text[]) and displayed in the Photos section of the detail view for all statuses. Add/remove of photos AFTER creation is supported in the work order detail view AND in the billing sheet view modal (CompletedWorkDetailModal) via the "Add Photos" button and an "X" remove overlay (with a confirmation dialog). Allowed roles for post-creation photo edits: company_admin, super_admin, irrigation_manager, billing_manager (full access on any record), and field_tech (only on work orders assigned to them, and only on billing sheets they created). Edits are blocked once a record is billed/invoiced or cancelled. Photo changes save immediately via PATCH /api/work-orders/:id and PATCH /api/billing-sheets/:id. The middleware `requireWorkOrderUpdateAccess` and `requireBillingSheetUpdateAccess` allows a photos-only payload (single key `photos: string[]`) from field techs scoped to ownership/assignment, in addition to their existing status-only paths. Important fix: previously, photos uploaded during billing sheet creation were silently dropped because the `onSubmit` handler in standalone-billing-sheet.tsx did not include the `uploadedPhotos` state in its submission payload — this is now fixed for both new sheets and manager edits.
Work Order Editing: Full work order editing available for irrigation managers and admins (company_admin, super_admin) on non-completed/non-cancelled work orders. An "Edit" button in the work order detail header opens the EditWorkOrderModal with all editable fields: project name, description, project address, location notes, scheduled date, priority, technician assignment, special instructions, and internal notes. Changes saved via PATCH /api/work-orders/:id. Field techs and billing managers do not see the edit button. Customer assignment and work order items are not editable through this form.
Work Order Assignment: The assignment dropdown on work orders includes both irrigation managers and field technicians, grouped by role (Managers / Field Techs). The `/api/users/field-techs` endpoint returns both `field_tech` and `irrigation_manager` active users. Reassignment in work order details also shows grouped managers and field techs.
IrrigoPro Display Name (irrigoName): Customers have a separate `irrigo_name` field (stored in the database as `irrigo_name`) that is the name shown to all IrrigoPro users throughout the app — intended to be a property name or nickname the field team recognizes. It defaults to the official customer name on creation and auto-fills from the customer name when adding new customers. Displayed as the primary name everywhere (customer list, profile, billing, site maps, customer selector). Official name shown as a faint subtitle only when it differs. In the customer form, the field is highlighted with a green bordered box, green badge labeled "Irrigo Facing", and a Tag icon so it is unmistakable. Search across all views matches both irrigoName and official name.

## Gotchas

- Field technicians cannot see any pricing information; this is enforced at the API level.
- Photos uploaded to billing sheets require the `uploadedPhotos` state in the submission payload for new sheets and manager edits.
- Estimates automatically create work orders upon approval; manual work order creation is for direct billing only.
- Company admin users have limited direct access to estimates and work orders pages; they view through modals.

## Pointers

- **React Query Docs**: _Populate as you build_
- **Drizzle ORM Docs**: _Populate as you build_
- **Tailwind CSS Docs**: _Populate as you build_
- **QuickBooks API Docs**: _Populate as you build_