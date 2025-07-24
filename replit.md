# Irrigation Business Management System

## Overview

This is a comprehensive full-stack irrigation business management system built with React, Express.js, and PostgreSQL. The application provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. It features zone-based estimates, customer integrations, and a modern UI built with shadcn/ui components and Tailwind CSS.

## User Preferences

Preferred communication style: Simple, everyday language.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request 2025-07-22).
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching (consolidated 2025-07-22).
Business Rules: Markup calculations apply only to parts subtotal, not parts + labor combined. Labor hours are per-part, not multiplied by quantity. Monthly invoice consolidation combines all customer work into single QuickBooks invoices.
Admin Access Restriction (2025-07-23): Company admin users should not have direct access to estimates and work orders pages - only view through modal previews in operations page. Removed navigation paths to /estimates and /work-orders for admin role.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite with hot module replacement
- **UI Framework**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens
- **State Management**: TanStack React Query for server state management
- **Routing**: Wouter for lightweight client-side routing
- **Forms**: React Hook Form with Zod validation

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM
- **Database Provider**: Neon Database (@neondatabase/serverless)
- **Schema Management**: Drizzle Kit for migrations
- **API Design**: RESTful API with JSON responses

### Project Structure
- `client/` - React frontend application
- `server/` - Express.js backend application
- `shared/` - Shared TypeScript schemas and types
- `migrations/` - Database migration files

## Key Components

### Complete Business Workflow
The system supports a full irrigation business workflow:
1. **Estimate Creation**: Zone-based estimates with parts and labor
2. **Customer Approval**: Estimate approval/rejection workflow
3. **Work Order Generation**: Convert approved estimates to work orders
4. **Field Work Management**: Track technician work and part usage
5. **Invoice Creation**: Generate invoices from completed work orders
6. **QuickBooks Integration**: Sync invoices and customer data
7. **Standalone Billing Sheets**: Capture billables for work done without work orders

### Monthly Invoice Consolidation Architecture
The system consolidates all customer work into single monthly QuickBooks invoices:
- **invoices** table redesigned with monthly period tracking (invoiceMonth, invoiceYear, periodStart, periodEnd)
- **invoiceItems** table tracks source type (work_order or billing_sheet) and source ID for detailed line item tracking
- Automatic consolidation of completed work orders and approved billing sheets by customer and month
- Professional QuickBooks format with detailed line items showing work dates, descriptions, technician names, and reference numbers
- Proper business rule implementation: 20% markup on parts only, labor calculated at $45/hr, 8.25% tax on total

### Database Schema
The system uses comprehensive database tables:
- **customers**: Customer information with contact details
- **parts**: Irrigation parts catalog with pricing and labor hours
- **estimates**: Project estimates with zone-based structure
- **estimateZones**: Individual zones within estimates
- **estimateItems**: Parts and quantities for each zone
- **propertyZones**: Property locations with multiple zones
- **zones**: Individual work zones with clock-in points
- **fieldWorkSessions**: Technician work sessions
- **fieldWorkItems**: Parts used during field work
- **workOrders**: Generated from approved estimates
- **workOrderItems**: Items included in work orders
- **invoices**: Generated from completed work orders
- **invoiceItems**: Line items for invoices
- **billingSheets**: Standalone billing for work without work orders
- **billingSheetItems**: Parts and labor items for standalone billing
- **quickbooksIntegration**: QuickBooks connection settings
- **quickbooksSync**: Sync status tracking

### API Endpoints
- **Dashboard**: Analytics and overview data
- **Customers**: CRUD operations with Google Sheets/QuickBooks integration
- **Parts**: CRUD operations with Google Docs sync capability
- **Estimates**: Zone-based estimate management with approval workflow
- **Property Zones**: Property and zone management with Google Sheets sync
- **Field Work**: Technician work session tracking
- **Work Orders**: Work order lifecycle management with invoice conversion
- **Invoices**: Invoice generation and QuickBooks sync from completed work orders
- **Billing Sheets**: Standalone billing system for work without work orders
- **QuickBooks Integration**: Customer and invoice sync
- **Integrations**: Google Sheets and QuickBooks customer sync

### Frontend Pages
- **Login**: Role-based authentication (Admin/Field Tech)
- **Dashboard**: Business overview with key metrics and recent activity (Admin only)
- **Estimates**: Zone-based estimate creation and management (Admin only)
- **Parts Catalog**: Comprehensive parts inventory management (Admin only)
- **Customers**: Customer management with integration capabilities (Admin only)
- **Field Tech**: Technician interface without pricing access (Admin only)
- **Work Orders**: Complete work order lifecycle management with invoice conversion (Admin only)
- **Field Portal**: Dedicated field technician interface with work session management
- **Billing Sheets**: Standalone billing system for both managers and technicians

### UI Components
- Comprehensive component library based on shadcn/ui
- Form components with validation
- Data tables with search and filtering
- Modal dialogs for estimate creation
- Toast notifications for user feedback
- Role-based authentication system
- Separate interfaces for admin and field technicians

### Authentication & Authorization
- **Role-based Access Control**: Admin and Field Tech roles with different permissions
- **Admin Interface**: Full system access with navigation, pricing, and management features
- **Field Tech Portal**: Dedicated interface for work session management without pricing access
- **Demo Credentials**: 
  - Admin: admin / admin123
  - Field Tech: tech / tech123
- **Session Management**: localStorage-based authentication with automatic redirects

## Data Flow

1. **User Input**: Forms collect user data with client-side validation
2. **API Requests**: TanStack React Query handles API communication
3. **Server Processing**: Express routes validate and process requests
4. **Database Operations**: Drizzle ORM manages PostgreSQL interactions
5. **Response Handling**: JSON responses with proper error handling
6. **UI Updates**: React Query automatically updates UI state

## External Dependencies

### Frontend Dependencies
- **UI Components**: Extensive Radix UI component library
- **Form Handling**: React Hook Form with Zod resolvers
- **Date Handling**: date-fns for date manipulation
- **Icons**: Lucide React for consistent iconography
- **Carousel**: Embla Carousel for image galleries

### Backend Dependencies
- **Database**: Neon Database serverless PostgreSQL
- **ORM**: Drizzle ORM with Zod schema validation
- **Session Management**: connect-pg-simple for PostgreSQL sessions

### Development Dependencies
- **TypeScript**: Full TypeScript support across the stack
- **Vite**: Fast development server with HMR
- **ESBuild**: Production bundling for backend
- **Tailwind CSS**: Utility-first CSS framework

## Deployment Strategy

### Development
- **Frontend**: Vite dev server with proxy to backend
- **Backend**: tsx for TypeScript execution in development
- **Database**: Drizzle Kit for schema management and migrations

### Production Build
- **Frontend**: Vite builds static assets to `dist/public`
- **Backend**: ESBuild bundles server code to `dist/index.js`
- **Database**: Environment variable `DATABASE_URL` for connection

### Environment Configuration
- Development and production modes supported
- Database connection via environment variables
- Vite configuration for asset handling and aliases
- TypeScript paths for clean imports

## Recent Changes (2025-07-23)

- Fixed critical pricing calculation bugs including "through the roof" labor calculations
- Corrected markup calculation to only apply to parts subtotal (not parts + labor) per business rules
- Updated both backend storage methods and frontend modal logic for consistent calculations
- Added edit button to estimate detail modal for seamless view-to-edit transition
- Unified estimate pricing display - totals now show correctly in list view, detail modal, and estimate summary
- **Mobile Responsiveness Overhaul**: Fixed overlapping issues on phones across all views with proper responsive breakpoints
- **Role-Based Data Filtering**: Field techs now only see work orders assigned to them and billing sheets they created
- **Field Tech Dashboard Redesign**: Clean two-card layout matching manager dashboard style
- **Enhanced Security**: Field techs cannot create new work orders, only view/manage assigned ones
- **Monthly Invoice Consolidation System**: Implemented monthly invoice generation that combines all work orders and billing sheets per customer into single QuickBooks invoices
- **Billing Sheet Integration**: Added photo upload capability and redesigned modal for field technicians with pricing information hidden
- **Unified Invoice Architecture**: Restructured invoice system to track both work order and billing sheet sources for comprehensive monthly billing
- **Sample Data Created**: Generated 5 completed work orders and 5 approved billing sheets for December 2024 showing consolidated invoice totaling $4,112.24
- **QuickBooks Integration Format**: Designed professional invoice layout with detailed line items, proper markup calculation (20% on parts only), and streamlined monthly billing
- **Complete Responsive Design Overhaul (2025-07-23)**: Implemented mobile-first responsive design across all pages with dual-layout approach (desktop table view + mobile card view)
- **Complete Estimate Approval Workflow (2025-07-23)**: Added missing approve/reject estimate functionality with full work order conversion process
- **Customer Email Approval System (2025-07-23)**: Implemented Postmark email integration for automated customer estimate approvals with secure token-based approval links
- **Work Order Details Modal Enhancement (2025-07-23)**: Applied estimate modal design patterns with prominent status banners, improved card layouts, and better information hierarchy. Subsequently streamlined by removing status banners except for completed status and moving complete button to dedicated bottom footer section for cleaner UX.
- **Work Order Button Logic Refinement (2025-07-23)**: Implemented intelligent button visibility - "View" buttons only appear on unassigned work orders, "Start Work Order" buttons replace "View" on assigned work orders, and "Add Details" button only appears when accessing via "Start Work Order" action for proper workflow control.
- **Admin Dashboard Implementation (2025-07-23)**: Created comprehensive admin dashboard with full user management capabilities including add/edit/delete users, role management, password controls, and system statistics. Includes proper validation, security features, and accessibility compliance.
- **Navigation Enhancement (2025-07-23)**: Center logo button in navigation now properly routes to current user's dashboard regardless of role, providing consistent navigation behavior across all user types.
- **Admin Dashboard Simplification (2025-07-23)**: Simplified admin dashboard to focus on two core areas (Operations Management, Customer Management) and removed user management section - user management is now exclusively available through dedicated Users page in bottom navigation. Applied universal layout wrapper fix to resolve sticky navigation spacing issues across all user roles.
- **Mobile Navigation Redesign (2025-07-23)**: Completely redesigned mobile navigation from hamburger menu to bottom navigation bar with role-based buttons. Desktop maintains top navigation while mobile users get iOS/Android-style bottom tabs for easy thumb navigation. Each user role gets customized navigation buttons for their allowed pages.
- **Mobile Navigation Enhancement (2025-07-23)**: Updated mobile navigation with prominent center dashboard button extending above the navigation bar. Simplified top bar to show only logo and notifications. Admin navigation redesigned with specific order: Operations, Customers, Dashboard (center), Parts, Users.
- **Admin Operations Page (2025-07-23)**: Created comprehensive operations page for admins showing all work items (estimates, work orders, billing sheets) in unified view with tabbed interface. Added create modal allowing admins to choose between creating estimates, work orders, or billing sheets from single location.
- **Enhanced Operations Modal Views (2025-07-24)**: Redesigned operations page modals with full-screen comprehensive detail views. Enhanced estimate, work order, and billing sheet modals with professional card layouts, status banners, timeline views, and detailed information sections. Admin users now have rich modal-based interfaces showing complete item details without needing access to dedicated pages.
- **Navigation Spacing Fix (2025-07-23)**: Resolved persistent unwanted spacing at top of all pages by identifying and removing the `<div className="h-20"></div>` bottom padding element in mobile navigation that was creating unwanted gaps. Added explicit `m-0 p-0` classes to mobile navigation containers to eliminate browser default margins/padding. This creates clean layout with content starting immediately after navigation bar.
- **Work Order Modal Simplification (2025-07-23)**: Removed Progress and Invoicing tabs from work order details modal, keeping only essential Overview tab. Added prominent "Start Work Order" button for pending/assigned orders and "Complete Work Order" button for in-progress orders. Changed "Completed" section in Assignment & Progress Details to "Status" section showing current work order status badge for clearer information hierarchy.
- **Work Order Assignment Fix (2025-07-24)**: Fixed critical issue where managers appeared as assignable users for work orders. Created dedicated `/api/users/field-techs` endpoint filtering only field technicians. Updated work orders page and work order details modal to use new endpoint. Removed "Manager" option from assignment dropdowns. Cleaned up existing work orders that were incorrectly assigned to managers by setting them back to unassigned status.

## Responsive Design Implementation (2025-07-23)

### Mobile-First Architecture
- **Dual Layout System**: Desktop table views (hidden on mobile) + mobile card layouts (hidden on desktop)
- **Breakpoint Strategy**: Uses lg: breakpoint (1024px) to switch between layouts
- **Touch-Friendly Interface**: Larger tap targets, improved spacing, and optimized for thumb navigation

### Pages Updated for Full Responsiveness:
- **Estimates Page**: Desktop table + mobile cards with status badges, action buttons, and touch-friendly interactions
- **Customers Page**: Contact information cards with email, phone, and address in mobile-optimized layout
- **Work Orders Page**: Already mobile-optimized with card-based design and field technician workflow
- **Billing Sheets Page**: Responsive grid with detailed information cards
- **Dashboard**: Responsive stats grid and navigation cards
- **Parts Catalog**: Responsive grid layout with mobile-friendly part information cards

### Mobile UX Enhancements:
- **Card-Based Layouts**: Information displayed in easy-to-scan cards with clear visual hierarchy
- **Flexible Typography**: Responsive text sizes using Tailwind's responsive utilities (text-sm sm:text-base)
- **Adaptive Spacing**: Mobile-optimized padding and margins (p-4 sm:p-6)
- **Touch Navigation**: Larger buttons and improved tap targets for mobile interaction
- **Content Prioritization**: Most important information shown prominently on smaller screens

### Technical Implementation:
- **Tailwind Responsive Classes**: Extensive use of sm:, md:, lg: prefixes for responsive behavior
- **Hidden/Visible Utilities**: Desktop tables hidden on mobile (hidden lg:block), mobile cards hidden on desktop (lg:hidden)
- **Flexbox & Grid**: Responsive layouts using flex-col sm:flex-row and grid responsive classes
- **Breakword Handling**: Proper text wrapping for long content (break-words, break-all)

The application now provides a seamless experience across all device sizes, from mobile phones to desktop monitors, with optimized layouts and interactions for each screen size.

## Mobile App Bar Redesign (2025-07-23)

### Mobile-First Navigation Architecture
- **Clean Three-Column Layout**: Hamburger menu (left), centered logo (middle), notifications (right)
- **Touch-Optimized**: Large tap targets and proper spacing for thumb navigation
- **Slide-Out Menu**: Full-screen navigation drawer with organized menu items and user profile section

### Navigation Features:
- **Hamburger Menu**: Slides out from left with all navigation items, active page highlighting, and user profile footer
- **Centered Branding**: Company logo prominently displayed in center of mobile header
- **Notification System**: Bell icon on right with unread count badges and dropdown panel
- **Account Access**: All user account features integrated into slide-out navigation menu
- **Desktop Preservation**: Full horizontal navigation maintained for desktop users (lg: breakpoint)
- **Consistent Experience**: Same functionality across all device sizes with appropriate layouts

### Technical Implementation:
- **Sheet Component**: Using shadcn/ui Sheet for slide-out mobile navigation
- **Avatar Components**: Consistent user representation with fallback initials in navigation menu
- **Notification System**: Real-time notification bell with unread counts and sliding panel
- **Responsive Breakpoints**: lg: (1024px) breakpoint switches between mobile and desktop layouts
- **State Management**: Mobile menu open/close state with automatic closure on navigation
- **Streamlined Interface**: Account features consolidated into navigation menu, notifications prominently displayed

## Notification System Implementation (2025-07-23)

### Comprehensive Notification Architecture
- **Database Schema**: notifications table with user targeting, types, read status, and entity linking
- **Real-time Updates**: 30-second polling with unread count badges
- **Workflow Integration**: Automated notifications for work order assignments, completions, and estimate approvals
- **User Experience**: Clean notification dropdown with mark-as-read functionality and entity navigation

## Customer Email Approval System (2025-07-23)

### Postmark Integration Architecture
- **Email Service**: Professional transactional email delivery via Postmark API
- **Secure Token System**: Cryptographically secure approval tokens for customer links
- **Database Tracking**: approval_token, approval_sent_at, and approval_responded_at fields in estimates table
- **Customer Experience**: One-click approve/reject links directly from email
- **Confirmation System**: Automatic confirmation emails sent after customer response
- **Professional Templates**: Mobile-responsive HTML emails with estimate details and clear action buttons

### Email Workflow Process
1. **Manager creates estimate** → System shows "Email Customer" button in estimate detail modal
2. **Manager clicks email button** → System generates secure token and sends professional approval email
3. **Customer receives email** → Professional template with estimate details and approve/reject buttons
4. **Customer clicks action** → Direct approval/rejection via secure link with confirmation page
5. **System updates status** → Estimate status changes to approved/rejected automatically
6. **Manager notification** → System can notify manager of customer decision (future enhancement)

### Technical Implementation
- **EmailService class**: Handles Postmark API integration with error handling
- **Approval endpoints**: `/approve-via-token/:token` and `/reject-via-token/:token` for customer responses  
- **Email templates**: Professional HTML/text templates with responsive design
- **Security**: Secure token generation and validation prevents unauthorized access
- **Error handling**: Graceful handling of expired/invalid tokens with user-friendly messages