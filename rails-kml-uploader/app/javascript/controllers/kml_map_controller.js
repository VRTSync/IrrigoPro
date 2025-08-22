import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { url: String }

  connect() {
    this.initializeMap()
    this.loadMapData()
  }

  initializeMap() {
    // Initialize Leaflet map
    this.map = L.map(this.element).setView([37.7749, -122.4194], 10)

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map)

    // Add satellite imagery option
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri'
    })

    // Layer control
    const baseMaps = {
      "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
      "Satellite": satellite
    }

    L.control.layers(baseMaps).addTo(this.map)

    // Create layer groups
    this.controllersLayer = L.layerGroup().addTo(this.map)
    this.zonesLayer = L.layerGroup().addTo(this.map)
  }

  async loadMapData() {
    try {
      const response = await fetch(this.urlValue)
      const data = await response.json()

      if (response.ok) {
        this.renderMapData(data)
        this.fitMapToBounds(data.bounds)
      } else {
        console.error('Failed to load map data:', data.error)
      }
    } catch (error) {
      console.error('Error loading map data:', error)
    }
  }

  renderMapData(data) {
    // Clear existing layers
    this.controllersLayer.clearLayers()
    this.zonesLayer.clearLayers()

    // Add controllers
    if (data.controllers && data.controllers.features) {
      data.controllers.features.forEach(feature => {
        this.addControllerMarker(feature)
      })
    }

    // Add zones
    if (data.zones && data.zones.features) {
      data.zones.features.forEach(feature => {
        this.addZoneFeature(feature)
      })
    }

    // Add layer control
    const overlayMaps = {
      "Controllers": this.controllersLayer,
      "Zones": this.zonesLayer
    }

    L.control.layers(null, overlayMaps, { collapsed: false }).addTo(this.map)
  }

  addControllerMarker(feature) {
    const coords = feature.geometry.coordinates
    const props = feature.properties

    // Create custom controller icon
    const controllerIcon = L.divIcon({
      html: `
        <div style="
          background-color: #0d6efd;
          color: white;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 12px;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">C</div>
      `,
      className: 'custom-controller-icon',
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    })

    const marker = L.marker([coords[1], coords[0]], { icon: controllerIcon })
      .bindPopup(this.createControllerPopup(props))
      .addTo(this.controllersLayer)

    return marker
  }

  addZoneFeature(feature) {
    const geometry = feature.geometry
    const props = feature.properties

    let layer

    switch (geometry.type) {
      case 'Point':
        // Zone as point (sprinkler, etc.)
        const zoneIcon = L.divIcon({
          html: `
            <div style="
              background-color: #198754;
              color: white;
              border-radius: 50%;
              width: 16px;
              height: 16px;
              border: 2px solid white;
              box-shadow: 0 1px 2px rgba(0,0,0,0.3);
            "></div>
          `,
          className: 'custom-zone-icon',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })

        layer = L.marker([geometry.coordinates[1], geometry.coordinates[0]], { icon: zoneIcon })
        break

      case 'Polygon':
        // Zone as polygon boundary
        const coordinates = geometry.coordinates[0].map(coord => [coord[1], coord[0]])
        layer = L.polygon(coordinates, {
          color: '#198754',
          fillColor: '#198754',
          fillOpacity: 0.2,
          weight: 2
        })
        break

      case 'LineString':
        // Zone as line (irrigation lines, etc.)
        const lineCoords = geometry.coordinates.map(coord => [coord[1], coord[0]])
        layer = L.polyline(lineCoords, {
          color: '#198754',
          weight: 3,
          opacity: 0.8
        })
        break
    }

    if (layer) {
      layer.bindPopup(this.createZonePopup(props))
        .addTo(this.zonesLayer)
    }

    return layer
  }

  createControllerPopup(props) {
    return `
      <div class="p-2">
        <h6 class="mb-2">${props.name}</h6>
        <div class="small">
          ${props.model ? `<div><strong>Model:</strong> ${props.model}</div>` : ''}
          ${props.serial_number ? `<div><strong>Serial:</strong> ${props.serial_number}</div>` : ''}
          <div><strong>Stations:</strong> ${props.station_count}</div>
          <div><strong>Zones:</strong> ${props.zones_count}</div>
          ${props.coverage_area ? `<div><strong>Coverage:</strong> ${props.coverage_area} acres</div>` : ''}
          ${props.description ? `<div class="mt-2 text-muted">${props.description}</div>` : ''}
        </div>
      </div>
    `
  }

  createZonePopup(props) {
    return `
      <div class="p-2">
        <h6 class="mb-2">${props.name}</h6>
        <div class="small">
          <div><strong>Controller:</strong> ${props.controller_name}</div>
          <div><strong>Station:</strong> ${props.station_number}</div>
          <div><strong>Type:</strong> ${props.zone_type.replace('_', ' ')}</div>
          ${props.area_acres > 0 ? `<div><strong>Area:</strong> ${props.area_acres} acres</div>` : ''}
          ${props.description ? `<div class="mt-2 text-muted">${props.description}</div>` : ''}
        </div>
      </div>
    `
  }

  fitMapToBounds(bounds) {
    if (bounds && bounds.west && bounds.south && bounds.east && bounds.north) {
      const leafletBounds = [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east]
      ]
      this.map.fitBounds(leafletBounds, { padding: [20, 20] })
    }
  }

  disconnect() {
    if (this.map) {
      this.map.remove()
    }
  }
}