# IrrigoPro - Irrigation Business Management System

## Overview
IrrigoPro is a comprehensive full-stack irrigation business management system. It provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. The system features zone-based estimates, customer integrations, and a modern UI. Its purpose is to streamline operations for irrigation businesses, offering a complete solution for managing field services, billing, and customer interactions.

## User Preferences
Preferred communication style: Simple, everyday language.
App Branding: Updated to "IrrigoPro" with professional blue color scheme and water droplet logo.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Navigation Improvements: Company admin navigation streamlined to 5 items with improved wording and Admin dropdown containing Team and Company management options for better alignment and organization.
Site Map Access Control: Site map creation is restricted to admin and super admin roles only. Managers and field techs can view existing site maps but cannot create new ones. Backend API creation routes protected with role-based middleware.
Customer Management Permissions: Complete role-based access control implemented for customer management. Irrigation managers and field technicians have strict view-only access - they cannot create, edit, or delete customers, cannot access integrations, and cannot edit property notes. Only company admin users have full customer management privileges including creation, editing, deletion, integrations access, and property notes editing. This ensures complete data integrity and prevents any unauthorized customer information modifications.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens
- **State Management**: TanStack React Query for server state
- **Routing**: Wouter
- **Forms**: React Hook Form with Zod validation
- **UI/UX Decisions**: Responsive design with a mobile-first approach, utilizing a dual-layout system (desktop table views + mobile card layouts). Comprehensive component library based on shadcn/ui. Mobile navigation redesigned to a bottom navigation bar with role-based buttons. Admin dashboard is simplified, focusing on operations and customer management. Work order details modal is streamlined.

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon Database (@neondatabase/serverless)
- **Schema Management**: Drizzle Kit for migrations
- **API Design**: RESTful API with JSON responses

### Core Features
- **Complete Business Workflow**: Supports estimate creation, customer approval, work order generation, field work management, invoice creation, and QuickBooks integration. Includes standalone billing sheets.
- **Monthly Invoice Consolidation**: Consolidates all customer work into single monthly QuickBooks invoices with tax-free calculations, tracking line items by source (work order or billing sheet). QuickBooks integration focuses on customer sync and invoice creation only - maintains existing company branding and formatting.
- **Role-based Access Control**: Admin, Manager, and Field Tech roles with distinct permissions and interfaces.
- **Site Maps & Controller Management System**: KML file import for visualizing irrigation controllers and zones on an interactive map using Leaflet. Includes role-based permissions for viewing and editing.
- **Customer Email Approval System**: Integrates with Postmark for secure, token-based customer estimate approvals via email.
- **Notification System**: Database-driven notifications with real-time updates for work order assignments, completions, and estimate approvals.
- **iOS PWA Push Notifications**: Complete Progressive Web App implementation with service worker, push notifications, badge counts, and iOS-specific optimizations for deployment as a native-like app experience.
- **Location Management Enhancement**: Comprehensive location fields (address, notes, access instructions) for estimates and work orders, with an optional interactive map-based location picker.

### Project Structure
- `client/` - React frontend application
- `server/` - Express.js backend application
- `shared/` - Shared TypeScript schemas and types
- `migrations/` - Database migration files

## External Dependencies

### Frontend Dependencies
- **UI Components**: Radix UI (via shadcn/ui)
- **Form Handling**: React Hook Form, Zod
- **Date Handling**: date-fns
- **Icons**: Lucide React
- **Carousel**: Embla Carousel
- **Mapping**: Leaflet, OpenStreetMap, Esri satellite tiles
- **PWA & Notifications**: Service Worker API, Notification API, Badge API for iOS PWA deployment

### Backend Dependencies
- **Database**: Neon Database (PostgreSQL)
- **ORM**: Drizzle ORM
- **Session Management**: connect-pg-simple
- **Email Service**: Postmark API
- **QuickBooks Integration**: OAuth2 authentication, customer sync, invoice creation

### Development Dependencies
- **TypeScript**
- **Vite**
- **ESBuild**
- **Tailwind CSS**

## Recent System Enhancements (January 2025)

### Authentication Security Enhancement
- **Password Reset System**: Implemented secure password reset via email with time-limited tokens (1-hour expiration)
- **Email Verification**: Added email verification system for new user accounts with 24-hour token expiration
- **Database Fields Added**: emailVerified, emailVerificationToken, emailVerificationExpires, passwordResetToken, passwordResetExpires
- **Security Features**: Password reset and email verification use cryptographically secure tokens, email templates with professional IrrigoPro branding
- **User Interface Integration**: Added "Forgot Password" link to login page, email verification status display in user profile, and dedicated password reset/forgot password pages
- **Email Service Extension**: Extended Postmark email service to handle authentication emails in addition to estimate approvals

### User Profile/Account Management
- **Complete User Profile Page**: Added comprehensive user profile interface accessible via "My Account" in user dropdown menus
- **Editable Fields**: Users can update name and email address with real-time validation
- **Account Information Display**: Shows role, company ID, member since date, and email verification status
- **Role-Based Integration**: Profile page integrated into all navigation systems (desktop/mobile) for all user roles
- **Security Status Indicators**: Visual indicators for email verification status with option to resend verification emails

### Work Order Completion Tracking
- **Enhanced User Context**: API client now sends user ID, name, and role headers with all requests for proper audit trails
- **Completion Tracking**: Added database fields (completed_by_user_id, completed_by_user_name) to track who actually completed work orders vs who was originally assigned
- **Notification Updates**: Work order completion notifications now display the actual completing user for better accountability

### Interface Improvements
- **Counter Accuracy**: Fixed work order status counter mismatch where "Pending" counter now correctly counts "assigned" status work orders (aligned with database schema)
- **Status Badge Consistency**: Updated status badge display to show both "assigned" and "pending" statuses as "Pending" for user clarity
- **Filter Alignment**: Synchronized filter buttons to work with actual database status values

### Company Admin User Management System
- **Complete User Management Interface**: Added comprehensive user management for company administrators with create, edit, and deactivate capabilities
- **Role-Based Access Control**: Company admins can only manage users within their own company, ensuring security and data isolation
- **User Statistics Dashboard**: Added real-time statistics showing total users, active users, and breakdowns by role (field techs, managers, etc.)
- **Company-Scoped API Routes**: Implemented secure API endpoints that automatically scope user operations to the authenticated admin's company
- **Navigation Integration**: Added "Users" menu option in company admin navigation for easy access to user management
- **Default Users**: Randy Mangel established as company admin user (randymangel/admin123) with proper company association for testing and initial setup

### Site Maps Architecture Restructure (January 2025)
- **Maps Page Simplification**: Converted main Maps page to display a clean list of available site maps with search functionality and customer information
- **Navigation Organization**: Updated company admin navigation to make "Customers" a dropdown with "Customer List" and "Maps" options for better feature grouping
- **Map Builder Access**: Site map builder tool is now exclusively accessible through individual customer profiles, providing better context and organization
- **Enhanced User Experience**: Maps page shows grid view of existing maps with customer details, creation dates, and direct links to customer profiles for map viewing/editing

### QuickBooks Integration Consolidation (January 2025)
- **Centralized Location**: QuickBooks integration component consolidated to Customer Billing page only for focused user experience
- **Simplified Access**: Removed QuickBooks integration from multiple page locations to prevent confusion and ensure consistent functionality
- **Working Implementation**: Fixed QuickBooks OAuth connection using direct fetch API calls instead of complex React Query mutations
- **Component Cleanup**: Removed debug logging and simplified component initialization for production-ready implementation
- **Deployment Ready**: Updated OAuth redirect URIs to automatically detect deployed .replit.app domains for stable QuickBooks integration
- **Development vs Production**: System now supports both development and deployed environments with proper domain detection
- **Custom Domain Support**: Added irrigopro.com domain detection for professional QuickBooks OAuth integration with custom branding
- **Production Ready Authentication**: Removed development user switcher and demo credentials for production deployment with proper login flow
- **VRTSync Branding Integration**: Added "Powered by VRTSync" footer with professional logo to all pages throughout the application for complete branding consistency

### Enhanced Logging and Troubleshooting System (August 2025)
- **Comprehensive Error Tracking**: Implemented centralized logging system with structured error capture for all application components
- **QuickBooks Transaction ID Capture**: All QuickBooks API interactions now capture and log `intuit_tid` headers for rapid Intuit support troubleshooting
- **Centralized Logger**: Created production-ready logging infrastructure with timestamp, context, user tracking, and metadata support
- **Troubleshooting APIs**: Added `/api/logs`, `/api/logs/export`, and `/api/logs/summary` endpoints for support team access
- **Error Context Preservation**: Enhanced error logging includes request details, user context, QuickBooks transaction IDs, and stack traces
- **Production Support Ready**: Log export functionality enables sharing detailed error information with support teams when troubleshooting issues
- **Developer Portal Compliance**: Logging system meets Intuit QuickBooks developer portal requirements for production application support