# IrrigoPro - Irrigation Business Management System

## Overview
IrrigoPro is a comprehensive full-stack irrigation business management system designed to streamline operations for irrigation businesses. It provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. Key capabilities include zone-based estimates, customer integrations, and a modern user interface, aiming to be a complete solution for managing field services, billing, and customer interactions.

## User Preferences
Preferred communication style: Simple, everyday language.
Site Map Display Preferences: Default display mode set to solid markers with zone/controller identifiers in the center, enhanced popups with detailed information. Maintain original styling and functionality unless explicitly requested to change.
App Branding: Updated to "IrrigoPro" with professional blue water droplet logo design featuring bright blue (#3B82F6) primary colors, dark gray borders, and light green accent details. Complete visual rebrand implemented across all interfaces, icons, and PWA assets. Production-ready company logo upload system with secure file storage, production domain handling (irrigopro.com), session-based authentication, comprehensive branding integration throughout pages (below header), customer approval emails, and email template management in company profile for professional communications.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Customer Approval System: Complete email approval workflow with individual estimate status check buttons, proper production domain URLs (irrigopro.com/estimate-approval), and professional customer-facing success pages that avoid admin interface confusion.
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Navigation Improvements: Company admin navigation streamlined to 5 items with improved wording and Admin dropdown containing Team and Company management options for better alignment and organization. Irrigation manager navigation simplified to focus on core operational tasks: Work Orders, Billing Sheets, Customers (view-only), Dashboard, and Parts (with catalog/list dropdown) - removed site maps access and complex billing dropdown for cleaner workflow. Mobile navigation optimized for irrigation managers with smart prioritization: ensures access to all 4 key areas (Work Orders, Billing, Customers, Parts Catalog) by selecting primary parts access over duplicate dropdown items.
Site Map Access Control: Site map viewing (read-only) is available to company administrators and irrigation managers. Complete CRUD operations (create, update, delete) are restricted to company administrators only. All other roles including super admins, billing managers, and field technicians have no access to site maps. Backend API routes are protected with appropriate access control middleware: requireSiteMapViewAccess for viewing operations and requireCompanyAdminAccess for modification operations.
Customer Management Permissions: Complete role-based access control implemented for customer management. Irrigation managers and field technicians have strict view-only access - they cannot create, edit, or delete customers, cannot access integrations, and cannot edit property notes. Only company admin and super admin users have full customer management privileges including creation, editing, deletion, integrations access, and property notes editing. Backend API routes are protected with requireAdminAccess middleware and frontend UI properly restricts access based on user roles. This ensures complete data integrity and prevents any unauthorized customer information modifications.
Parts Management Independence: Parts catalog operates independently from QuickBooks integration. Internal parts CRUD system provides complete inventory control without external dependencies. QuickBooks integration removed from parts catalog to ensure reliable operation and reduce complexity.
Development Testing Features: Switch User functionality is currently available for development testing but must be completely removed before production deployment. This includes removing the switch-user routes from all user role configurations and removing the Switch User button from the profile dropdown in the navigation component.
Production Security: All debug console.log statements removed from customer creation flow. Authentication uses session-based user lookup instead of localStorage for production compatibility. Form validation properly handles missing user data with graceful fallbacks.
Animated Loading Skeletons: Comprehensive loading skeleton system implemented across all major pages (Dashboard, Customers, Work Orders, Estimates, Parts Catalog) with smooth fade-in animations and staggered timing for enhanced user experience during page transitions. All components use production-safe API authentication patterns.
QuickBooks Access Restrictions: Complete QuickBooks access removal implemented for irrigation managers and field technicians. All QuickBooks API endpoints protected with role-based middleware, QuickBooks tab removed from estimates page for restricted roles, and backend routes return 403 access denied errors for unauthorized access attempts. Only company administrators, super administrators, and billing managers have QuickBooks integration access.
Production Optimizations: Site map system fully optimized for production deployment with hybrid authentication approach. Site map routes support both development header-based authentication and production session-based authentication. Production middleware performs database user lookups only when session data is available, falling back to header authentication for development compatibility. This ensures reliable operation in production while maintaining development workflow compatibility.
Work Order and Billing Sheet Management: Company administrators and billing managers have full edit and delete permissions for work orders and billing sheets. Backend API routes are protected with role-based middleware (requireWorkOrderBillingAccess) ensuring only authorized users can modify or delete these critical business documents. Frontend UI provides Edit and Delete buttons for authorized roles with confirmation dialogs for destructive actions.
Parts Catalog Access: Billing managers and irrigation managers have comprehensive parts catalog access with full CRUD permissions. This includes viewing all parts with pricing information, creating and editing individual parts, advanced filtering and search, and QuickBooks integration for parts sync. Bulk import functionality is restricted to company administrators and super administrators only. Additionally, irrigation managers have access to both the full Parts Catalog and a simplified Parts List view through a dropdown navigation menu, providing flexibility for different use cases. The parts catalog provides extensive inventory management capabilities for all management-level personnel while maintaining appropriate permission controls.

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
- **Database**: PostgreSQL with Drizzle ORM, hosted on Neon Database (@neondatabase/serverless).
- **Schema Management**: Drizzle Kit for migrations.
- **API Design**: RESTful API with JSON responses.

### Core Features
- **Complete Business Workflow**: Supports estimate creation, customer approval, work order generation, field work management, invoice creation, and QuickBooks integration. Includes standalone billing sheets.
- **Monthly Invoice Consolidation**: Consolidates all customer work into single monthly QuickBooks invoices with tax-free calculations.
- **Role-based Access Control**: Admin, Manager, and Field Tech roles with distinct permissions and interfaces.
- **Site Maps & Controller Management System**: KML file import for visualizing irrigation controllers and zones on an interactive map using Leaflet. Site map builder is accessible through individual customer profiles.
- **Customer Email Approval System**: Complete token-based customer estimate approval system with Postmark email integration. Features dedicated customer approval pages at /estimate-approval/:token with professional success confirmations, proper production domain handling (irrigopro.com), and individual estimate status checking capabilities. Customers receive clean approval experiences without access to admin interfaces.
- **Notification System**: Database-driven notifications with real-time updates for work order assignments, completions, and estimate approvals.
- **iOS PWA Push Notifications**: Progressive Web App implementation with service worker, push notifications, and iOS-specific optimizations.
- **Location Management Enhancement**: Comprehensive location fields with an optional interactive map-based location picker.
- **Authentication & Security**: Secure password reset, email verification, and Multi-Factor Authentication (MFA) using TOTP with backup codes. Comprehensive error tracking with QuickBooks transaction ID capture and a centralized logging system.
- **User Management**: Company administrators have full user management capabilities within their own company.

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
- **QuickBooks Integration**: OAuth2 authentication, customer sync with active-only filtering, invoice creation. Prioritizes company names over individual names for business customers.