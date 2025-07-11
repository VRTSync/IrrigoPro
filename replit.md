# Irrigation Business Management System

## Overview

This is a full-stack irrigation business management system built with React, Express.js, and PostgreSQL. The application provides comprehensive tools for managing customers, parts catalog, and estimates for irrigation projects. It features a modern UI built with shadcn/ui components and Tailwind CSS, with a robust backend API for data management.

## User Preferences

Preferred communication style: Simple, everyday language.

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

### Database Schema
The system uses four main database tables:
- **customers**: Customer information (name, email, phone, address)
- **parts**: Irrigation parts catalog with pricing and labor hours
- **estimates**: Project estimates with customer details and totals
- **estimateItems**: Line items linking estimates to parts with quantities

### API Endpoints
- **Dashboard**: `/api/dashboard/stats` - Analytics and overview data
- **Customers**: CRUD operations for customer management
- **Parts**: CRUD operations for parts catalog management
- **Estimates**: CRUD operations for project estimates with line items

### Frontend Pages
- **Dashboard**: Overview with statistics and recent activity
- **Estimates**: Create and manage project estimates
- **Parts Catalog**: Manage irrigation parts inventory
- **Customers**: Customer relationship management

### UI Components
- Comprehensive component library based on shadcn/ui
- Form components with validation
- Data tables with search and filtering
- Modal dialogs for estimate creation
- Toast notifications for user feedback

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