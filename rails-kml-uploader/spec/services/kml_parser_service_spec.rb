require 'rails_helper'

RSpec.describe KmlParserService, type: :service do
  let(:user) { create(:user) }
  let(:kml_file) { create(:kml_file, user: user) }
  let(:service) { described_class.new(kml_file) }

  describe '#parse!' do
    let(:sample_kml) do
      <<~KML
        <?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <Placemark>
              <name>Controller A</name>
              <description>Model: Hunter Pro-C, Serial: 12345, Stations: 8</description>
              <Point>
                <coordinates>-122.4194,37.7749,0</coordinates>
              </Point>
            </Placemark>
            <Placemark>
              <name>Zone 1 Sprinklers</name>
              <description>Front lawn sprinkler coverage</description>
              <Point>
                <coordinates>-122.4184,37.7759,0</coordinates>
              </Point>
            </Placemark>
            <Placemark>
              <name>Zone Coverage Area</name>
              <description>Polygon zone boundary</description>
              <Polygon>
                <outerBoundaryIs>
                  <LinearRing>
                    <coordinates>
                      -122.4194,37.7749,0
                      -122.4184,37.7749,0
                      -122.4184,37.7759,0
                      -122.4194,37.7759,0
                      -122.4194,37.7749,0
                    </coordinates>
                  </LinearRing>
                </outerBoundaryIs>
              </Polygon>
            </Placemark>
          </Document>
        </kml>
      KML
    end

    before do
      kml_file.file.attach(
        io: StringIO.new(sample_kml),
        filename: 'test.kml',
        content_type: 'application/vnd.google-earth.kml+xml'
      )
    end

    it 'successfully parses KML and creates controllers and zones' do
      expect { service.parse! }.to change(Controller, :count).by(1)
                                .and change(Zone, :count).by(2)
      
      kml_file.reload
      expect(kml_file.status).to eq('completed')
      expect(kml_file.controllers_count).to eq(1)
      expect(kml_file.zones_count).to eq(2)
    end

    it 'creates controller with correct attributes' do
      service.parse!
      
      controller = Controller.first
      expect(controller.name).to eq('Controller A')
      expect(controller.model).to eq('Hunter Pro-C')
      expect(controller.serial_number).to eq('12345')
      expect(controller.station_count).to eq(8)
      expect(controller.latitude).to be_within(0.0001).of(37.7749)
      expect(controller.longitude).to be_within(0.0001).of(-122.4194)
    end

    it 'creates zones with correct attributes' do
      service.parse!
      
      point_zone = Zone.find_by(name: 'Zone 1 Sprinklers')
      expect(point_zone).to be_present
      expect(point_zone.boundary_type).to eq('Point')
      expect(point_zone.zone_type).to eq('sprinkler')
      
      polygon_zone = Zone.find_by(name: 'Zone Coverage Area')
      expect(polygon_zone).to be_present
      expect(polygon_zone.boundary_type).to eq('Polygon')
    end

    context 'when KML parsing fails' do
      before do
        kml_file.file.attach(
          io: StringIO.new('invalid xml content'),
          filename: 'invalid.kml',
          content_type: 'application/vnd.google-earth.kml+xml'
        )
      end

      it 'sets status to failed and records error message' do
        expect { service.parse! }.to raise_error(StandardError)
        
        kml_file.reload
        expect(kml_file.status).to eq('failed')
        expect(kml_file.error_message).to be_present
      end
    end
  end

  describe 'private methods' do
    describe '#controller_name?' do
      it 'identifies controller names correctly' do
        expect(service.send(:controller_name?, 'Controller A')).to be true
        expect(service.send(:controller_name?, 'Clock Station B')).to be true
        expect(service.send(:controller_name?, 'Zone 1 Clock')).to be false
        expect(service.send(:controller_name?, 'Sprinkler Zone')).to be false
      end
    end

    describe '#determine_zone_type' do
      it 'correctly determines zone types from names' do
        expect(service.send(:determine_zone_type, 'Pop up sprinklers')).to eq('pop_up')
        expect(service.send(:determine_zone_type, 'Rotor heads')).to eq('rotor')
        expect(service.send(:determine_zone_type, 'Drip irrigation')).to eq('drip')
        expect(service.send(:determine_zone_type, 'Spray heads')).to eq('pop_up')
        expect(service.send(:determine_zone_type, 'Unknown zone')).to eq('other')
      end
    end

    describe '#extract_station_number' do
      it 'extracts station numbers from zone names' do
        expect(service.send(:extract_station_number, 'Zone 5 sprinklers')).to eq(5)
        expect(service.send(:extract_station_number, 'Controller zone 12')).to eq(12)
        expect(service.send(:extract_station_number, 'No number here')).to eq(1)
      end
    end
  end
end