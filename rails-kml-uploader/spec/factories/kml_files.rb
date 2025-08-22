FactoryBot.define do
  factory :kml_file do
    association :user
    name { Faker::Lorem.words(3).join(' ') }
    status { :pending }
    controllers_count { 0 }
    zones_count { 0 }

    after(:build) do |kml_file|
      kml_file.file.attach(
        io: StringIO.new(sample_kml_content),
        filename: 'test.kml',
        content_type: 'application/vnd.google-earth.kml+xml'
      )
    end

    trait :completed do
      status { :completed }
      controllers_count { 2 }
      zones_count { 8 }
      processed_at { 1.hour.ago }
    end

    trait :failed do
      status { :failed }
      error_message { 'Failed to parse KML file' }
    end
  end

  def sample_kml_content
    <<~KML
      <?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <name>Test Controller</name>
            <description>Test controller for factory</description>
            <Point>
              <coordinates>-122.4194,37.7749,0</coordinates>
            </Point>
          </Placemark>
        </Document>
      </kml>
    KML
  end
end