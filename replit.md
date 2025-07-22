# Irrigation Business Management System

## Overview

This is a comprehensive full-stack irrigation business management system built with React, Express.js, and PostgreSQL. The application provides complete business workflow management from estimates through work orders to invoices, with QuickBooks integration and field technician capabilities. It features zone-based estimates, customer integrations, and a modern UI built with shadcn/ui components and Tailwind CSS.

## User Preferences

Preferred communication style: Simple, everyday language.
Manager Dashboard: Show only Estimates, Work Orders, and Billing Sheets cards (Parts List removed per user request 2025-07-22).
Dashboard Navigation: All dashboard cards should use consistent navigation to main pages rather than internal view switching (consolidated 2025-07-22).

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

The application follows modern full-stack development practices with type safety throughout, efficient state management, and a clean separation of concerns between frontend and backend code.