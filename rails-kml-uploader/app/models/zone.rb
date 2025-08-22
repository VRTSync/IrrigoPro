class Zone < ApplicationRecord
  belongs_to :controller
  has_one :kml_file, through: :controller
  
  validates :name, presence: true
  validates :station_number, presence: true, 
            numericality: { greater_than: 0, less_than_or_equal_to: 64 },
            uniqueness: { scope: :controller_id }

  # PostGIS geometry column for zone boundaries
  # boundary can be Point, Polygon, or LineString depending on KML data

  enum zone_type: {
    sprinkler: 0,
    drip: 1,
    rotor: 2,
    pop_up: 3,
    spray: 4,
    bubbler: 5,
    micro_spray: 6,
    other: 7
  }

  scope :by_controller, ->(controller) { where(controller: controller) }
  scope :by_station, ->(station_number) { where(station_number: station_number) }
  scope :with_boundaries, -> { where.not(boundary: nil) }

  def boundary_type
    return nil unless boundary
    
    result = ApplicationRecord.connection.execute(
      "SELECT ST_GeometryType('#{boundary}'::geometry) as geom_type"
    ).first
    
    case result['geom_type']
    when 'ST_Point'
      'Point'
    when 'ST_Polygon'
      'Polygon'  
    when 'ST_LineString'
      'LineString'
    else
      'Unknown'
    end
  end

  def center_coordinates
    return nil unless boundary
    
    result = ApplicationRecord.connection.execute(
      "SELECT ST_Y(ST_Centroid('#{boundary}'::geometry)) as lat,
              ST_X(ST_Centroid('#{boundary}'::geometry)) as lng"
    ).first
    
    [result['lat'].to_f, result['lng'].to_f]
  end

  def boundary_coordinates
    return nil unless boundary
    
    case boundary_type
    when 'Point'
      get_point_coordinates
    when 'Polygon'
      get_polygon_coordinates
    when 'LineString'
      get_linestring_coordinates
    else
      nil
    end
  end

  def area_square_meters
    return 0 unless boundary && boundary_type == 'Polygon'
    
    result = ApplicationRecord.connection.execute(
      "SELECT ST_Area(ST_Transform('#{boundary}'::geometry, 3857)) as area"
    ).first
    
    result['area']&.to_f || 0
  end

  def area_acres
    (area_square_meters / 4046.86).round(2)
  end

  def perimeter_meters
    return 0 unless boundary
    
    result = ApplicationRecord.connection.execute(
      "SELECT ST_Perimeter(ST_Transform('#{boundary}'::geometry, 3857)) as perimeter"
    ).first
    
    result['perimeter']&.to_f || 0
  end

  def self.create_with_point(latitude, longitude, attributes = {})
    point = "POINT(#{longitude} #{latitude})"
    create!(attributes.merge(boundary: point))
  end

  def self.create_with_polygon(coordinates_array, attributes = {})
    # coordinates_array should be array of [lng, lat] pairs
    points = coordinates_array.map { |coord| "#{coord[0]} #{coord[1]}" }.join(', ')
    polygon = "POLYGON((#{points}))"
    create!(attributes.merge(boundary: polygon))
  end

  def to_geojson
    {
      type: "Feature",
      geometry: boundary_to_geojson,
      properties: {
        id: id,
        name: name,
        controller_id: controller_id,
        controller_name: controller.name,
        station_number: station_number,
        zone_type: zone_type,
        coverage: coverage,
        area_acres: area_acres,
        description: description
      }
    }
  end

  def self.to_geojson_collection(zones)
    {
      type: "FeatureCollection", 
      features: zones.map(&:to_geojson)
    }
  end

  private

  def get_point_coordinates
    result = ApplicationRecord.connection.execute(
      "SELECT ST_Y('#{boundary}'::geometry) as lat,
              ST_X('#{boundary}'::geometry) as lng"
    ).first
    
    [result['lat'].to_f, result['lng'].to_f]
  end

  def get_polygon_coordinates
    result = ApplicationRecord.connection.execute(
      "SELECT ST_AsText('#{boundary}'::geometry) as coords"
    ).first
    
    coords_text = result['coords']
    # Parse POLYGON((lng lat, lng lat, ...)) format
    coords_text.gsub(/POLYGON\(\(|\)\)/, '').split(',').map do |coord_pair|
      lng, lat = coord_pair.strip.split(' ').map(&:to_f)
      [lat, lng] # Return as [lat, lng] for frontend
    end
  end

  def get_linestring_coordinates
    result = ApplicationRecord.connection.execute(
      "SELECT ST_AsText('#{boundary}'::geometry) as coords"
    ).first
    
    coords_text = result['coords']
    # Parse LINESTRING(lng lat, lng lat, ...) format
    coords_text.gsub(/LINESTRING\(|\)/, '').split(',').map do |coord_pair|
      lng, lat = coord_pair.strip.split(' ').map(&:to_f)
      [lat, lng] # Return as [lat, lng] for frontend
    end
  end

  def boundary_to_geojson
    return nil unless boundary
    
    case boundary_type
    when 'Point'
      coords = get_point_coordinates
      {
        type: "Point",
        coordinates: [coords[1], coords[0]] # GeoJSON uses [lng, lat]
      }
    when 'Polygon'
      coords = get_polygon_coordinates
      {
        type: "Polygon",
        coordinates: [coords.map { |coord| [coord[1], coord[0]] }] # Convert to [lng, lat]
      }
    when 'LineString'
      coords = get_linestring_coordinates
      {
        type: "LineString",
        coordinates: coords.map { |coord| [coord[1], coord[0]] } # Convert to [lng, lat]
      }
    else
      nil
    end
  end
end