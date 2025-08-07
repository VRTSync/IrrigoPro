# Setup Instructions for Irrigation KML Mapping Demo

## Quick Start

1. **Install Node.js** (version 16 or higher)
   - Download from [nodejs.org](https://nodejs.org/)

2. **Install dependencies**:
   ```bash
   cd irrigation-kml-mapping-demo
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser** to the URL shown in the terminal (usually `http://localhost:5173`)

## Using the Demo

### Step 1: Prepare KML Files
Create two types of KML files:

**Controller KML Example:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Clock A</name>
      <description>Model: Rain Bird ESP-6TM, Serial: 12345, Stations: 8</description>
      <Point>
        <coordinates>-105.0123456,39.9876543,1500</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>
```

**Zone KML Example:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Clock A zone 1 pop ups</name>
      <description>Controller: Clock A, Station: 1, Type: Pop-ups, Coverage: Front lawn</description>
      <Point>
        <coordinates>-105.0124000,39.9877000,1500</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Clock A zone 2 rotors</name>
      <description>Controller: Clock A, Station: 2, Type: Rotors, Coverage: Side yard</description>
      <Point>
        <coordinates>-105.0125000,39.9878000,1500</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>
```

### Step 2: Demo Workflow
1. Select a customer from the dropdown
2. Upload a controller KML file (should contain irrigation controllers)
3. Select which controller to upload zones for
4. Upload a zone KML file (should contain zones for that controller)
5. Review the parsed data in the summary section

## Key Features Demonstrated

- **KML File Parsing**: Shows how to parse XML-based KML files using browser DOM parser
- **Data Structure Design**: Demonstrates proper TypeScript interfaces for irrigation data
- **Component Architecture**: Shows React component design with props and state management
- **Color-Coded Visualization**: Each controller gets a unique color, zones inherit controller colors
- **Error Handling**: Proper validation and error messages for invalid files
- **User Interface**: Clean, step-by-step workflow for ease of use

## Educational Value

This demo teaches:
- File upload and processing in React
- XML/KML parsing techniques
- TypeScript interface design
- React component architecture
- State management patterns
- Agricultural technology applications
- Real-world data modeling

## Customization

You can modify:
- `src/lib/kml-parser.ts` - Change parsing logic or add new data fields
- `src/components/IrrigationMapDemo.tsx` - Modify the user interface
- Controller colors in the `controllerColors` array
- Add new zone types in the parsing logic
- Extend data validation rules

## Browser Compatibility

Works in all modern browsers that support:
- ES2020 features
- File API
- DOMParser
- React 18+

No additional plugins or server setup required!