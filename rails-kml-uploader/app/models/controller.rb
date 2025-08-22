class Controller < ApplicationRecord
  belongs_to :kml_file
  has_many :zones, dependent: :destroy
  
  validates :name, presence: true
  validates :location, presence: true
  validates :station_count, presence: true, numericality: { greater_than: 0, less_than_or_equal_to: 64 }

  # PostGIS point column for geospatial data
  # location is a geometry(Point,4326) column

  scope :with_location, -> { where.not(location: nil) }
  scope :by_kml_file, ->(kml_file) { where(kml_file: kml_file) }

  def latitude
    return nil unless location
    ApplicationRecord.connection.execute(
      "SELECT ST_Y('#{location}'::geometry) as lat"
    ).first['lat'].to_f
  end

  def longitude
    return nil unless location
    ApplicationRecord.connection.execute(
      "SELECT ST_X('#{location}'::geometry) as lng"
    ).first['lng'].to_f
  end

  def coordinates
    [latitude, longitude]
  end

  def self.create_with_coordinates(latitude, longitude, attributes = {})
    point = "POINT(#{longitude} #{latitude})"
    create!(attributes.merge(location: point))
  end

  def update_coordinates(latitude, longitude)
    point = "POINT(#{longitude} #{latitude})"
    update!(location: point)
  end

  def zones_count
    zones.count
  end

  def coverage_area
    return 0 unless zones.any?
    
    # Calculate total coverage area from all zones
    result = ApplicationRecord.connection.execute(
      "SELECT SUM(ST_Area(ST_Transform(boundary, 3857))) as total_area 
       FROM zones 
       WHERE controller_id = #{id} AND boundary IS NOT NULL"
    ).first
    
    area_sqm = result['total_area']&.to_f || 0
    # Convert square meters to acres (1 acre = 4046.86 square meters)
    (area_sqm / 4046.86).round(2)
  end

  def to_geojson
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude]
      },
      properties: {
        id: id,
        name: name,
        model: model,
        serial_number: serial_number,
        station_count: station_count,
        zones_count: zones_count,
        coverage_area: coverage_area,
        description: description
      }
    }
  end

  def self.to_geojson_collection(controllers)
    {
      type: "FeatureCollection",
      features: controllers.map(&:to_geojson)
    }
  end
end