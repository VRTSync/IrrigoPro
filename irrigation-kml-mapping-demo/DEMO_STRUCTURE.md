# Irrigation KML Mapping Demo - File Structure

```
irrigation-kml-mapping-demo/
├── README.md                 # Project overview and documentation
├── SETUP.md                 # Installation and usage instructions
├── DEMO_STRUCTURE.md        # This file - explains the structure
├── package.json             # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── tsconfig.node.json      # Node-specific TypeScript config
├── vite.config.ts          # Vite build tool configuration
├── index.html              # Main HTML entry point
│
├── public/
│   └── vite.svg            # Default Vite icon
│
├── src/
│   ├── main.tsx            # React app entry point
│   ├── App.tsx             # Main app component
│   ├── App.css             # Styling and CSS utilities
│   │
│   ├── lib/
│   │   └── kml-parser.ts   # Core KML parsing logic
│   │
│   └── components/
│       └── IrrigationMapDemo.tsx  # Main demo interface component
│
└── sample-data/
    ├── sample-controllers.kml     # Example controller KML file
    ├── sample-zones-clock-a.kml   # Example zones for Clock A
    └── sample-zones-clock-b.kml   # Example zones for Clock B
```

## Key Components Explained

### Core Files

**src/lib/kml-parser.ts**
- The heart of the system - parses KML files
- Extracts controller and zone data from XML
- Handles various KML formats and structures
- ~580 lines of robust parsing logic

**src/components/IrrigationMapDemo.tsx**
- Main user interface component
- Handles file uploads and data management
- Color-codes controllers and zones
- Step-by-step workflow interface

### Configuration Files

**package.json**
- Lists all required dependencies (React, TypeScript, Leaflet, etc.)
- Defines build scripts for development and production
- Educational package focused on irrigation mapping

**vite.config.ts**
- Modern build tool configuration
- Enables hot module replacement for development
- Optimized for fast builds and live updates

### Sample Data

**sample-data/*.kml**
- Ready-to-use KML files for demonstration
- Shows proper format for controllers and zones
- Includes realistic irrigation system data

## Technical Architecture

### Data Flow
1. User uploads KML file → File API reads content
2. KML Parser → Parses XML using DOM parser
3. Data extraction → Controllers and zones identified
4. Color assignment → Each controller gets unique color
5. UI update → Data displayed in organized interface

### Key Features Demonstrated
- File upload handling in React
- XML parsing with native browser APIs
- TypeScript interface design
- State management patterns
- Component composition
- Error handling and validation

### Educational Value
Perfect for teaching:
- Modern web development practices
- Agricultural technology applications
- File format processing
- React component architecture
- TypeScript usage in real projects

## Running the Demo

1. `npm install` - Install dependencies
2. `npm run dev` - Start development server
3. Open browser to localhost:5173
4. Use sample KML files for demonstration

The demo runs entirely in the browser - no server required!