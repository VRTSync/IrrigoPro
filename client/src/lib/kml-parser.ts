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
      parseString(kmlString, (err, result) => {
        if (err) {
          reject(new Error(`Failed to parse KML: ${err.message}`));
          return;
        }

        try {
          const parsed = this.extractKMLData(result);
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Failed to extract KML data: ${error}`));
        }
      });
    });
  }

  private static extractKMLData(kmlData: any): ParsedKMLData {
    const controllers: KMLController[] = [];
    const zones: KMLZone[] = [];
    let allCoordinates: Array<[number, number]> = [];

    // Navigate KML structure
    const document = kmlData.kml?.Document?.[0] || kmlData.kml;
    const placemarks = this.findPlacemarks(document);

    placemarks.forEach((placemark: any) => {
      const name = placemark.name?.[0] || 'Unnamed';
      const description = placemark.description?.[0] || '';
      
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
      }
    });

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
    
    if (data.Placemark) {
      placemarks.push(...data.Placemark);
    }
    
    if (data.Folder) {
      data.Folder.forEach((folder: any) => {
        placemarks.push(...this.findPlacemarks(folder));
      });
    }

    return placemarks;
  }

  private static parseController(placemark: any, name: string, description: string): KMLController | null {
    const coordinates = placemark.Point?.[0]?.coordinates?.[0];
    if (!coordinates) return null;

    const coords = coordinates.split(',').map((c: string) => parseFloat(c.trim()));
    if (coords.length < 2) return null;

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