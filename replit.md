# IrrigoPro - Irrigation Business Management System

## Overview
IrrigoPro is a comprehensive full-stack irrigation business management system designed to streamline operations for irrigation businesses. It provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. The project aims to be a complete solution for managing field services, billing, and customer interactions, offering zone-based estimates, customer integrations, and a modern user interface.

## User Preferences
Preferred communication style: Simple, everyday language.
Site Map Display Preferences: Default display mode set to solid markers with zone/controller identifiers in the center, enhanced popups with detailed information. Maintain original styling and functionality unless explicitly requested to change.
App Branding: Updated to "IrrigoPro" with professional blue water droplet logo design featuring bright blue (#3B82F6) primary colors, dark gray borders, and light green accent details. Production-ready company logo upload system with secure file storage, production domain handling (irrigopro.com), session-based authentication, comprehensive branding integration throughout pages (below header), customer approval emails, and email template management in company profile for professional communications.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Customer Approval System: Complete email approval workflow with individual estimate status check buttons, proper production domain URLs (irrigopro.com/estimate-approval), and professional customer-facing success pages that avoid admin interface confusion.
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Navigation Improvements: Company admin navigation streamlined to 5 items with improved wording and Admin dropdown containing Team and Company management options for better alignment and organization. Irrigation manager navigation enhanced to include comprehensive business management: Estimates (full estimate system access), Work Orders, Billing Sheets, Customers (with site map viewing), Dashboard, and Parts (with catalog/list dropdown). Mobile navigation optimized for irrigation managers with smart prioritization: ensures access to all key business areas including the complete estimate management system.
Site Map Access Control: Site map viewing (read-only) is available to company administrators, irrigation managers, and field technicians. Complete CRUD operations (create, update, delete) are restricted to company administrators only. All other roles including super admins and billing managers have no access to site maps. Backend API routes are protected with appropriate access control middleware: requireSiteMapViewAccess for viewing operations and requireCompanyAdminAccess for modification operations.
Customer Management Permissions: Complete role-based access control implemented for customer management. Irrigation managers and field technicians have strict view-only access - they cannot create, edit, or delete customers, cannot access integrations, and cannot edit property notes. Only company admin and super admin users have full customer management privileges including creation, editing, deletion, integrations access, and property notes editing. Backend API routes are protected with requireAdminAccess middleware and frontend UI properly restricts access based on user roles. This ensures complete data integrity and prevents any unauthorized customer information modifications.
Parts Management Independence: Parts catalog operates independently from QuickBooks integration. Internal parts CRUD system provides complete inventory control without external dependencies. QuickBooks integration removed from parts catalog to ensure reliable operation and reduce complexity.
Development Testing Features: Switch User functionality is currently available for development testing but must be completely removed before production deployment. This includes removing the switch-user routes from all user role configurations and removing the Switch User button from the profile dropdown in the navigation component.
Production Security: All debug console.log statements removed from customer creation flow. Authentication uses session-based user lookup instead of localStorage for production compatibility. Form validation properly handles missing user data with graceful fallbacks.
Animated Loading Skeletons: Comprehensive loading skeleton system implemented across all major pages (Dashboard, Customers, Work Orders, Estimates, Parts Catalog) with smooth fade-in animations and staggered timing for enhanced user experience during page transitions. All components use production-safe API authentication patterns.
QuickBooks Access Restrictions: Complete QuickBooks access removal implemented for irrigation managers and field technicians. All QuickBooks API endpoints protected with role-based middleware, QuickBooks tab removed from estimates page for restricted roles, and backend routes return 403 access denied errors for unauthorized access attempts. Only company administrators, super administrators, and billing managers have QuickBooks integration access.
Field Tech Pricing Visibility: CRITICAL SECURITY FEATURE - Field technicians NEVER see pricing or money values anywhere in the app. All pricing fields (laborRate, laborSubtotal, partsSubtotal, totalAmount, unitPrice, cost, price, markupAmount, taxAmount, etc.) are automatically stripped from API responses when the user role is field_tech. This is implemented via the applyPricingVisibility() function in server/routes.ts which recursively sanitizes objects and arrays. Applies to work orders, work order items, billing sheets, and parts endpoints. Field techs can see work details and quantities but not any financial data.
Production Optimizations: Site map system fully optimized for production deployment with hybrid authentication approach. Site map routes support both development header-based authentication and production session-based authentication. Production middleware performs database user lookups only when session data is available, falling back to header authentication for development compatibility. This ensures reliable operation in production while maintaining development workflow compatibility.
Work Order and Billing Sheet Management: Company administrators and billing managers have full edit and delete permissions for work orders and billing sheets. Backend API routes are protected with role-based middleware (requireWorkOrderBillingAccess) ensuring only authorized users can modify or delete these critical business documents. Frontend UI provides Edit and Delete buttons for authorized roles with confirmation dialogs for destructive actions.
Parts Catalog Access: Billing managers and irrigation managers have comprehensive parts catalog access with full CRUD permissions. This includes viewing all parts with pricing information, creating and editing individual parts, advanced filtering and search, and QuickBooks integration for parts sync. Bulk import functionality is restricted to company administrators and super administrators only. Additionally, irrigation managers have access to both the full Parts Catalog and a simplified Parts List view through a dropdown navigation menu, providing flexibility for different use cases. The parts catalog provides extensive inventory management capabilities for all management-level personnel while maintaining appropriate permission controls.
Work Order Photo Uploads: Photos can be attached during work order creation via the FileUpload component. Uploaded photos are stored in the work order's `photos` array field and displayed in the Photos section of the work order details view for all statuses. Billing sheets also support photo uploads at creation time. Managers (irrigation_manager) and admins (company_admin, super_admin) can add and remove photos on any existing work order at any time via the "Add Photos" button and X remove overlay in the work order detail view. Photo changes are saved immediately via PATCH /api/work-orders/:id. Field techs and billing managers see photos as read-only with no edit controls.
Work Order Assignment: The assignment dropdown on work orders includes both irrigation managers and field technicians, grouped by role (Managers / Field Techs). The `/api/users/field-techs` endpoint returns both `field_tech` and `irrigation_manager` active users. Reassignment in work order details also shows grouped managers and field techs.
Location Picker Enhancements: The LocationPicker component features a live GPS tracking dot (pulsing blue circle) that continuously shows the user's real-time position on the map. A "Use My Location" button snaps the work location pin to the user's GPS coordinates with reverse geocoding. The map automatically re-centers when the customer/community selection changes using `map.flyTo()` for smooth transitions.
Phone-Based User Login: New company team members use their phone number as their login username. The phone field is required when creating new users, and the username is automatically set to the phone number. Email is optional. Existing users with text-slug usernames are completely unaffected.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, Vite as build tool.
- **UI/UX**: shadcn/ui components with Radix UI primitives, Tailwind CSS for styling. Responsive design with a mobile-first approach, utilizing a dual-layout system (desktop table views + mobile card layouts). Mobile navigation uses a bottom navigation bar with role-based buttons.
- **State Management**: TanStack React Query for server state.
- **Routing**: Wouter.
- **Forms**: React Hook Form with Zod validation.

### Backend Architecture
- **Runtime**: Node.js with Express.js.
- **Language**: TypeScript with ES modules.
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema Management**: Drizzle Kit for migrations.
- **API Design**: RESTful API with JSON responses.

### Core Features
- **Complete Business Workflow**: Estimates, customer approval, work order generation, field work, invoicing, and standalone billing sheets.
- **Monthly Invoice Consolidation**: Consolidates customer work into single monthly, tax-free QuickBooks invoices.
- **Role-based Access Control**: Admin, Manager, and Field Tech roles with distinct permissions.
- **Site Maps & Controller Management System**: KML import for interactive irrigation maps using Leaflet.
- **Customer Email Approval System**: Token-based estimate approval with Postmark email integration and dedicated approval pages.
- **Notification System**: Database-driven notifications for work order assignments, completions, and estimate approvals.
- **iOS PWA Push Notifications**: PWA implementation with service worker and push notifications.
- **Location Management Enhancement**: Comprehensive location fields with an optional interactive map-based picker.
- **Authentication & Security**: Secure password reset, email verification, MFA (TOTP with backup codes).
- **User Management**: Company administrators manage users within their company.
- **External Work Order API**: REST API for CRM integration allowing external systems to create and track work orders with API key authentication.

## External Dependencies

### Frontend Dependencies
- **UI Components**: Radix UI (via shadcn/ui)
- **Form Handling**: React Hook Form, Zod
- **Date Handling**: date-fns
- **Icons**: Lucide React
- **Carousel**: Embla Carousel
- **Mapping**: Leaflet, OpenStreetMap, Esri satellite tiles
- **PWA & Notifications**: Service Worker API, Notification API, Badge API

### Backend Dependencies
- **Database**: Neon Database (PostgreSQL)
- **ORM**: Drizzle ORM
- **Session Management**: connect-pg-simple
- **Email Service**: Postmark API
- **QuickBooks Integration**: OAuth2 authentication, customer sync, invoice creation.