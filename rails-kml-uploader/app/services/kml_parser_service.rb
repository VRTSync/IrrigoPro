class KmlParserService
  include ActiveModel::Model
  
  attr_accessor :kml_file_model, :file_content

  def initialize(kml_file_model)
    @kml_file_model = kml_file_model
    @file_content = kml_file_model.file.download
  end

  def parse!
    Rails.logger.info "Starting KML parsing for file: #{kml_file_model.name}"
    
    kml_file_model.update!(status: :processing)
    
    begin
      parsed_data = parse_kml_content
      create_controllers_and_zones(parsed_data)
      kml_file_model.update!(
        status: :completed,
        controllers_count: parsed_data[:controllers].size,
        zones_count: parsed_data[:zones].size,
        processed_at: Time.current
      )
      
      Rails.logger.info "KML parsing completed successfully"
      
    rescue StandardError => e
      Rails.logger.error "KML parsing failed: #{e.message}"
      Rails.logger.error e.backtrace.join("\n")
      
      kml_file_model.update!(
        status: :failed,
        error_message: e.message
      )
      
      raise e
    end
  end

  private

  def parse_kml_content
    doc = Nokogiri::XML(file_content)
    
    raise "Invalid KML file: No KML root element found" unless doc.at_xpath('//kml')
    
    Rails.logger.info "KML document loaded, finding placemarks"
    
    placemarks = doc.xpath('//Placemark')
    Rails.logger.info "Found #{placemarks.size} placemarks"
    
    controllers = []
    zones = []
    
    placemarks.each_with_index do |placemark, index|
      name = extract_text(placemark, 'name') || "Unnamed #{index + 1}"
      description = extract_text(placemark, 'description') || ''
      
      Rails.logger.debug "Processing placemark: #{name}"
      
      if point_element = placemark.at_xpath('.//Point')
        if controller_name?(name)
          controller_data = parse_controller_placemark(point_element, name, description)
          controllers << controller_data if controller_data
        else
          zone_data = parse_zone_point_placemark(point_element, name, description)
          zones << zone_data if zone_data
        end
      elsif polygon_element = placemark.at_xpath('.//Polygon')
        zone_data = parse_zone_polygon_placemark(polygon_element, name, description)
        zones << zone_data if zone_data
      elsif linestring_element = placemark.at_xpath('.//LineString')
        zone_data = parse_zone_linestring_placemark(linestring_element, name, description)
        zones << zone_data if zone_data
      end
    end
    
    Rails.logger.info "Parsed #{controllers.size} controllers and #{zones.size} zones"
    
    {
      controllers: controllers,
      zones: zones
    }
  end

  def create_controllers_and_zones(parsed_data)
    ApplicationRecord.transaction do
      # Create controllers
      controller_mapping = {}
      
      parsed_data[:controllers].each do |controller_data|
        controller = Controller.create_with_coordinates(
          controller_data[:latitude],
          controller_data[:longitude],
          {
            kml_file: kml_file_model,
            name: controller_data[:name],
            description: controller_data[:description],
            model: controller_data[:model],
            serial_number: controller_data[:serial_number],
            station_count: controller_data[:station_count] || 8
          }
        )
        
        controller_mapping[controller_data[:name]] = controller
        Rails.logger.debug "Created controller: #{controller.name}"
      end
      
      # Create zones
      parsed_data[:zones].each do |zone_data|
        # Find associated controller
        controller = find_controller_for_zone(zone_data, controller_mapping)
        
        next unless controller
        
        zone_attributes = {
          controller: controller,
          name: zone_data[:name],
          station_number: zone_data[:station_number] || 1,
          zone_type: determine_zone_type(zone_data[:name]),
          coverage: zone_data[:coverage],
          description: zone_data[:description]
        }
        
        case zone_data[:geometry_type]
        when :point
          Zone.create_with_point(
            zone_data[:latitude],
            zone_data[:longitude],
            zone_attributes
          )
        when :polygon
          Zone.create_with_polygon(
            zone_data[:coordinates],
            zone_attributes
          )
        when :linestring
          zone_attributes[:boundary] = create_linestring_wkt(zone_data[:coordinates])
          Zone.create!(zone_attributes)
        end
        
        Rails.logger.debug "Created zone: #{zone_data[:name]} for controller: #{controller.name}"
      end
    end
  end

  def extract_text(element, xpath)
    element.at_xpath(".//#{xpath}")&.text&.strip
  end

  def controller_name?(name)
    name.downcase.include?('controller') || 
    (name.downcase.include?('clock') && !name.downcase.include?('zone'))
  end

  def parse_controller_placemark(point_element, name, description)
    coordinates_text = extract_text(point_element, 'coordinates')
    return nil unless coordinates_text
    
    coords = parse_coordinates(coordinates_text)
    return nil unless coords
    
    {
      name: name,
      latitude: coords[:latitude],
      longitude: coords[:longitude],
      description: description,
      model: extract_from_description(description, 'Model:', 'Serial:'),
      serial_number: extract_from_description(description, 'Serial:', 'Stations:'),
      station_count: extract_station_count(description)
    }
  end

  def parse_zone_point_placemark(point_element, name, description)
    coordinates_text = extract_text(point_element, 'coordinates')
    return nil unless coordinates_text
    
    coords = parse_coordinates(coordinates_text)
    return nil unless coords
    
    {
      name: name,
      latitude: coords[:latitude],
      longitude: coords[:longitude],
      description: description,
      coverage: description,
      station_number: extract_station_number(name),
      controller_name: extract_controller_from_zone_name(name),
      geometry_type: :point
    }
  end

  def parse_zone_polygon_placemark(polygon_element, name, description)
    # Get outer boundary coordinates
    coordinates_text = extract_text(polygon_element, './/outerBoundaryIs//coordinates') ||
                      extract_text(polygon_element, 'coordinates')
    
    return nil unless coordinates_text
    
    coordinates = parse_coordinate_string(coordinates_text)
    return nil if coordinates.empty?
    
    {
      name: name,
      description: description,
      coverage: description,
      station_number: extract_station_number(name),
      controller_name: extract_controller_from_zone_name(name),
      coordinates: coordinates,
      geometry_type: :polygon
    }
  end

  def parse_zone_linestring_placemark(linestring_element, name, description)
    coordinates_text = extract_text(linestring_element, 'coordinates')
    return nil unless coordinates_text
    
    coordinates = parse_coordinate_string(coordinates_text)
    return nil if coordinates.empty?
    
    {
      name: name,
      description: description,
      coverage: description,
      station_number: extract_station_number(name),
      controller_name: extract_controller_from_zone_name(name),
      coordinates: coordinates,
      geometry_type: :linestring
    }
  end

  def parse_coordinates(coordinates_text)
    coords = coordinates_text.split(',').map(&:to_f)
    return nil if coords.size < 2
    
    {
      longitude: coords[0],
      latitude: coords[1],
      altitude: coords[2] || 0
    }
  end

  def parse_coordinate_string(coordinates_text)
    coordinates_text.strip.split(/\s+/).map do |coord_pair|
      coords = coord_pair.split(',').map(&:to_f)
      next if coords.size < 2
      [coords[0], coords[1]] # [longitude, latitude]
    end.compact
  end

  def extract_from_description(description, start_marker, end_marker = nil)
    return nil unless description&.include?(start_marker)
    
    start_index = description.index(start_marker) + start_marker.length
    end_index = end_marker ? description.index(end_marker, start_index) : description.length
    
    return nil unless end_index
    
    description[start_index...end_index].strip
  end

  def extract_station_count(description)
    station_str = extract_from_description(description, 'Stations:', '') ||
                 extract_from_description(description, 'stations:', '')
    
    return 8 unless station_str
    
    count = station_str.to_i
    count > 0 ? count : 8
  end

  def extract_station_number(name)
    match = name.match(/zone\s+(\d+)/i)
    match ? match[1].to_i : 1
  end

  def extract_controller_from_zone_name(name)
    # Extract controller name from zone names like "Clock B zone 7 pop ups" -> "Clock B"
    name.split(/\s+zone\s+\d+/i).first&.strip
  end

  def find_controller_for_zone(zone_data, controller_mapping)
    controller_name = zone_data[:controller_name]
    
    # Try exact match first
    return controller_mapping[controller_name] if controller_name && controller_mapping[controller_name]
    
    # Try fuzzy matching
    controller_mapping.keys.find do |key|
      key.downcase.include?(controller_name&.downcase || '') ||
      (controller_name&.downcase&.include?(key.downcase) || false)
    end&.then { |key| controller_mapping[key] }
  end

  def determine_zone_type(name)
    name_lower = name.downcase
    
    case name_lower
    when /pop[_\s]?up/, /spray/
      'pop_up'
    when /rotor/
      'rotor'
    when /drip/, /micro/
      'drip'
    when /sprinkler/
      'sprinkler'
    when /bubbler/
      'bubbler'
    else
      'other'
    end
  end

  def create_linestring_wkt(coordinates)
    points = coordinates.map { |coord| "#{coord[0]} #{coord[1]}" }.join(', ')
    "LINESTRING(#{points})"
  end
end