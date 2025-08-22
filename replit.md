# IrrigoPro - Irrigation Business Management System

## Overview
IrrigoPro is a comprehensive full-stack irrigation business management system designed to streamline operations for irrigation businesses. It provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. Key capabilities include zone-based estimates, customer integrations, and a modern user interface, aiming to be a complete solution for managing field services, billing, and customer interactions.

## User Preferences
Preferred communication style: Simple, everyday language.
App Branding: Updated to "IrrigoPro" with professional blue color scheme and water droplet logo.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Navigation Improvements: Company admin navigation streamlined to 5 items with improved wording and Admin dropdown containing Team and Company management options for better alignment and organization.
Site Map Access Control: Site map creation is restricted to admin and super admin roles only. Managers and field techs can view existing site maps but cannot create new ones. Backend API creation routes protected with role-based middleware.
Customer Management Permissions: Complete role-based access control implemented for customer management. Irrigation managers and field technicians have strict view-only access - they cannot create, edit, or delete customers, cannot access integrations, and cannot edit property notes. Only company admin and super admin users have full customer management privileges including creation, editing, deletion, integrations access, and property notes editing. Backend API routes are protected with requireAdminAccess middleware and frontend UI properly restricts access based on user roles. This ensures complete data integrity and prevents any unauthorized customer information modifications.
Parts Management Independence: Parts catalog operates independently from QuickBooks integration. Internal parts CRUD system provides complete inventory control without external dependencies. QuickBooks integration removed from parts catalog to ensure reliable operation and reduce complexity.

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
- **Customer Email Approval System**: Integrates with Postmark for secure, token-based customer estimate approvals via email.
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