# Irrigation KML Mapping System Demo

A complete React-based system for importing and visualizing irrigation controller and zone data from KML files. This system provides interactive mapping capabilities with color-coded controllers and zones.

## Features

- **KML File Import**: Parse KML files containing irrigation controllers and zones
- **Interactive Mapping**: View controllers and zones on interactive maps using Leaflet
- **Color-Coded Visualization**: Each controller gets a unique color with matching zones
- **Role-Based Access**: Admin controls for creation, view-only access for field techs
- **Customer Association**: Site maps can be associated with specific customers
- **Zone Management**: Upload and manage zones for each controller separately

## System Architecture

### Core Components

1. **KML Parser** (`lib/kml-parser.ts`) - Parses KML files and extracts controller/zone data
2. **Site Maps Page** (`components/site-maps-page.tsx`) - Main interface for the mapping system
3. **Controller Upload** (`components/controller-upload.tsx`) - Handles controller KML uploads
4. **Zone Upload** (`components/zone-upload.tsx`) - Handles zone KML uploads for each controller
5. **Map Viewer** (`components/color-coded-map-viewer.tsx`) - Interactive map display
6. **Data Review** (`components/color-coded-data-review.tsx`) - Data validation and review

### Data Structure

**Controllers**: Point placemarks with metadata
- Name, model, serial number, station count
- GPS coordinates (lat/lng)
- Unique color assignment

**Zones**: Point placemarks linked to controllers
- Zone name, type (rotors, pop-ups, drip)
- Station number extraction from name
- Controller association via naming convention
- GPS coordinates for precise location

## KML File Format Requirements

### Controller KML Files
```xml
<Placemark>
  <name>Main Controller</name>
  <description>Model: Rain Bird ESP-6TM, Serial: 12345, Stations: 8</description>
  <Point>
    <coordinates>-105.0123456,39.9876543,1500</coordinates>
  </Point>
</Placemark>
```

### Zone KML Files
```xml
<Placemark>
  <name>Clock A zone 7 pop ups</name>
  <description>Controller: Clock A, Station: 7, Type: Pop-ups, Coverage: Front lawn</description>
  <Point>
    <coordinates>-105.0123456,39.9876543,1500</coordinates>
  </Point>
</Placemark>
```

## User Workflow

1. **Select Customer** - Choose which customer the site map belongs to
2. **Upload Controller KML** - Import controller locations and metadata
3. **Select Controller** - Choose which controller to upload zones for
4. **Upload Zone KML** - Import zone locations for the selected controller
5. **Review Data** - Validate imported data and view on interactive map
6. **View Map** - Explore the color-coded irrigation system layout

## Role-Based Access Control

- **Admin/Super Admin**: Full access - create, edit, view site maps
- **Manager**: View existing site maps, cannot create new ones
- **Field Tech**: View existing site maps, cannot create new ones

## Technology Stack

- **Frontend**: React + TypeScript
- **UI Components**: shadcn/ui with Radix UI primitives
- **Mapping**: Leaflet.js with OpenStreetMap/Esri satellite tiles
- **Styling**: Tailwind CSS
- **File Parsing**: Native DOM parser for KML processing
- **State Management**: React hooks with local state

## Installation & Setup

1. Install dependencies:
```bash
npm install react typescript leaflet @types/leaflet
npm install @radix-ui/react-* # for UI components
npm install tailwindcss # for styling
```

2. Copy the provided source files to your project
3. Import and use the `SiteMapsPage` component
4. Ensure Leaflet CSS is included in your project

## Demo Data

The system has been tested with real irrigation system data including:
- Multiple controllers (Clock A, Clock B, Clock C)
- Various zone types (rotors, pop-ups, drip irrigation)
- Complex site layouts with 20+ zones per controller

## Educational Use

This system demonstrates:
- File parsing and data extraction techniques
- Interactive mapping with Leaflet
- React component architecture
- TypeScript interface design
- User role management
- Real-world irrigation system modeling

Perfect for demonstrating modern web development practices in an agricultural/landscaping context.