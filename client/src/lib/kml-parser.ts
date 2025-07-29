import { parseString } from 'xml2js';

export interface KMLController {
  name: string;
  latitude: number;
  longitude: number;
  description?: string;
  model?: string;
  serialNumber?: string;
  stationCount?: number;
}

export interface KMLZone {
  name: string;
  controllerName?: string;
  stationNumber?: number;
  boundaries?: Array<[number, number]>; // [lat, lng] pairs
  description?: string;
  zoneType?: string;
  coverage?: string;
}

export interface ParsedKMLData {
  controllers: KMLController[];
  zones: KMLZone[];
  centerLat: number;
  centerLng: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

export class KMLParser {
  static async parseKMLFile(file: File): Promise<ParsedKMLData> {
    const text = await file.text();
    return this.parseKMLString(text);
  }

  static async parseKMLString(kmlString: string): Promise<ParsedKMLData> {
    return new Promise((resolve, reject) => {
      // Validate KML string
      if (!kmlString || kmlString.trim().length === 0) {
        reject(new Error('KML file is empty or invalid'));
        return;
      }

      // Check if it's actually a KML file
      if (!kmlString.toLowerCase().includes('<kml') && !kmlString.toLowerCase().includes('<?xml')) {
        reject(new Error('File does not appear to be a valid KML file'));
        return;
      }

      console.log('Parsing KML string, length:', kmlString.length);
      console.log('First 500 chars:', kmlString.substring(0, 500));
      
      parseString(kmlString, { 
        explicitArray: true,
        ignoreAttrs: true,
        mergeAttrs: false,
        trim: true,
        normalize: true,
        explicitRoot: false
      }, (err, result) => {
        if (err) {
          console.error('XML parsing error:', err);
          reject(new Error(`Failed to parse KML XML: ${err.message}`));
          return;
        }

        if (!result) {
          reject(new Error('No data returned from XML parser'));
          return;
        }

        try {
          // Don't log full structure as it might be too large
          console.log('Parsed KML structure keys:', Object.keys(result));
          if (result.kml) {
            console.log('KML root keys:', Object.keys(result.kml));
          }
          const parsed = this.extractKMLData(result);
          console.log('Extraction successful:', { 
            controllers: parsed.controllers.length, 
            zones: parsed.zones.length 
          });
          resolve(parsed);
        } catch (error) {
          console.error('KML extraction error:', error);
          console.error('KML structure keys:', Object.keys(result));
          if (result.kml) {
            console.error('KML root keys:', Object.keys(result.kml));
          }
          reject(new Error(`Failed to extract KML data: ${error instanceof Error ? error.message : error}`));
        }
      });
    });
  }

  private static extractKMLData(kmlData: any): ParsedKMLData {
    const controllers: KMLController[] = [];
    const zones: KMLZone[] = [];
    let allCoordinates: Array<[number, number]> = [];

    console.log('Extracting from KML data keys:', Object.keys(kmlData || {}));

    // Navigate KML structure - handle Google Earth exports
    let document;
    
    // Try different KML structures
    if (kmlData.kml && kmlData.kml.Document) {
      document = Array.isArray(kmlData.kml.Document) ? kmlData.kml.Document[0] : kmlData.kml.Document;
    } else if (kmlData.Document) {
      document = Array.isArray(kmlData.Document) ? kmlData.Document[0] : kmlData.Document;
    } else if (kmlData.kml) {
      document = kmlData.kml;
    } else {
      document = kmlData;
    }

    console.log('Found document with keys:', Object.keys(document || {}));
    
    if (!document) {
      throw new Error('No Document element found in KML file');
    }

    const placemarks = this.findPlacemarks(document);
    console.log('Found placemarks:', placemarks.length);

    placemarks.forEach((placemark: any, index: number) => {
      console.log(`Processing placemark ${index}:`, Object.keys(placemark || {}));
      
      const name = (Array.isArray(placemark.name) ? placemark.name[0] : placemark.name) || `Unnamed ${index + 1}`;
      const description = (Array.isArray(placemark.description) ? placemark.description[0] : placemark.description) || '';
      
      console.log(`Placemark ${index}: name="${name}", hasPoint=${!!placemark.Point}, hasPolygon=${!!placemark.Polygon}, hasLineString=${!!placemark.LineString}`);
      
      // Check if this is a controller (point) or zone (polygon/line)
      if (placemark.Point) {
        const controller = this.parseController(placemark, name, description);
        if (controller) {
          controllers.push(controller);
          allCoordinates.push([controller.latitude, controller.longitude]);
        }
      } else if (placemark.Polygon || placemark.LineString) {
        const zone = this.parseZone(placemark, name, description);
        if (zone) {
          zones.push(zone);
          if (zone.boundaries) {
            allCoordinates.push(...zone.boundaries);
          }
        }
      } else {
        console.log(`Placemark ${index} has no Point, Polygon, or LineString - skipping`);
      }
    });

    console.log(`Extraction complete: ${controllers.length} controllers, ${zones.length} zones, ${allCoordinates.length} total coordinates`);

    // Provide default location if no coordinates found
    if (allCoordinates.length === 0) {
      console.log('No coordinates found, using default location');
      allCoordinates.push([37.7749, -122.4194]); // San Francisco default
    }

    // Calculate bounds and center
    const bounds = this.calculateBounds(allCoordinates);
    const center = this.calculateCenter(bounds);

    return {
      controllers,
      zones,
      centerLat: center.lat,
      centerLng: center.lng,
      bounds
    };
  }

  private static findPlacemarks(data: any): any[] {
    const placemarks: any[] = [];
    
    if (!data) {
      console.log('No data provided to findPlacemarks');
      return placemarks;
    }

    // Direct placemarks
    if (data.Placemark) {
      console.log('Found direct placemarks:', data.Placemark.length);
      placemarks.push(...data.Placemark);
    }
    
    // Placemarks in folders
    if (data.Folder) {
      console.log('Found folders:', data.Folder.length);
      data.Folder.forEach((folder: any) => {
        placemarks.push(...this.findPlacemarks(folder));
      });
    }

    // Check if data is an array (sometimes KML structure varies)
    if (Array.isArray(data)) {
      data.forEach((item: any) => {
        placemarks.push(...this.findPlacemarks(item));
      });
    }

    return placemarks;
  }

  private static parseController(placemark: any, name: string, description: string): KMLController | null {
    console.log('Parsing controller placemark:', { name, hasPoint: !!placemark.Point });
    
    const coordinates = placemark.Point?.[0]?.coordinates?.[0];
    if (!coordinates) {
      console.log('No coordinates found for controller:', name);
      return null;
    }

    console.log('Raw coordinates:', coordinates);
    const coords = coordinates.split(',').map((c: string) => parseFloat(c.trim()));
    if (coords.length < 2) {
      console.log('Invalid coordinate format:', coords);
      return null;
    }

    // Extract controller details from description (if formatted)
    const model = this.extractFromDescription(description, 'Model:', 'Serial:') || 
                  this.extractFromDescription(description, 'model:', 'serial:');
    const serialNumber = this.extractFromDescription(description, 'Serial:', 'Stations:') || 
                        this.extractFromDescription(description, 'serial:', 'stations:');
    const stationCountStr = this.extractFromDescription(description, 'Stations:', '') || 
                           this.extractFromDescription(description, 'stations:', '');
    const stationCount = stationCountStr ? parseInt(stationCountStr) : 8;

    return {
      name,
      longitude: coords[0],
      latitude: coords[1],
      description,
      model,
      serialNumber,
      stationCount: isNaN(stationCount) ? 8 : stationCount
    };
  }

  private static parseZone(placemark: any, name: string, description: string): KMLZone | null {
    let boundaries: Array<[number, number]> = [];

    // Handle polygon boundaries
    if (placemark.Polygon) {
      const coordinates = placemark.Polygon[0]?.outerBoundaryIs?.[0]?.LinearRing?.[0]?.coordinates?.[0];
      if (coordinates) {
        boundaries = this.parseCoordinateString(coordinates);
      }
    }

    // Handle line string boundaries
    if (placemark.LineString) {
      const coordinates = placemark.LineString[0]?.coordinates?.[0];
      if (coordinates) {
        boundaries = this.parseCoordinateString(coordinates);
      }
    }

    // Extract zone details from description
    const controllerName = this.extractFromDescription(description, 'Controller:', 'Station:') || 
                          this.extractFromDescription(description, 'controller:', 'station:');
    const stationStr = this.extractFromDescription(description, 'Station:', 'Type:') || 
                      this.extractFromDescription(description, 'station:', 'type:');
    const stationNumber = stationStr ? parseInt(stationStr) : undefined;
    const zoneType = this.extractFromDescription(description, 'Type:', 'Coverage:') || 
                     this.extractFromDescription(description, 'type:', 'coverage:') || 'sprinkler';
    const coverage = this.extractFromDescription(description, 'Coverage:', '') || 
                    this.extractFromDescription(description, 'coverage:', '');

    return {
      name,
      boundaries: boundaries.length > 0 ? boundaries : undefined,
      description,
      controllerName,
      stationNumber: isNaN(stationNumber || 0) ? undefined : stationNumber,
      zoneType,
      coverage
    };
  }

  private static parseCoordinateString(coordString: string): Array<[number, number]> {
    return coordString
      .trim()
      .split(/\s+/)
      .map((coord: string) => {
        const parts = coord.split(',');
        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[0]);
        return [lat, lng] as [number, number]; // [lat, lng]
      })
      .filter((coord): coord is [number, number] => !isNaN(coord[0]) && !isNaN(coord[1]));
  }

  private static extractFromDescription(description: string, startMarker: string, endMarker: string): string | undefined {
    const startIndex = description.indexOf(startMarker);
    if (startIndex === -1) return undefined;

    const start = startIndex + startMarker.length;
    const endIndex = endMarker ? description.indexOf(endMarker, start) : description.length;
    
    return description
      .substring(start, endIndex === -1 ? description.length : endIndex)
      .trim();
  }

  private static calculateBounds(coordinates: Array<[number, number]>) {
    if (coordinates.length === 0) {
      return { north: 0, south: 0, east: 0, west: 0 };
    }

    const lats = coordinates.map(c => c[0]);
    const lngs = coordinates.map(c => c[1]);

    return {
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs)
    };
  }

  private static calculateCenter(bounds: any) {
    return {
      lat: (bounds.north + bounds.south) / 2,
      lng: (bounds.east + bounds.west) / 2
    };
  }
}