# Irrigation Business Management System

## Overview
This is a comprehensive full-stack irrigation business management system. It provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. The system features zone-based estimates, customer integrations, and a modern UI. Its purpose is to streamline operations for irrigation businesses, offering a complete solution for managing field services, billing, and customer interactions.

## User Preferences
Preferred communication style: Simple, everyday language.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request).
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching.
Business Rules: No markup on parts (bill at cost), no tax calculations on any charges. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices with tax-free totals. Estimates automatically create work orders when approved - manual work order creation is only for direct billing (non-estimate) work.
Admin Access Restriction: Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.
Site Map Access Control: Site map creation is restricted to admin and super admin roles only. Managers and field techs can view existing site maps but cannot create new ones. Backend API creation routes protected with role-based middleware.

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