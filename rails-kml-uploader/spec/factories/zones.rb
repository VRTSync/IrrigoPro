FactoryBot.define do
  factory :zone do
    association :controller
    sequence(:name) { |n| "Zone #{n}" }
    sequence(:station_number) { |n| n }
    boundary { "POINT(#{Faker::Address.longitude} #{Faker::Address.latitude})" }
    zone_type { Zone.zone_types.keys.sample }
    coverage { Faker::Lorem.sentence }
    description { Faker::Lorem.paragraph }

    trait :polygon do
      boundary do
        # Create a simple square polygon
        lng = Faker::Address.longitude.to_f
        lat = Faker::Address.latitude.to_f
        offset = 0.001
        
        "POLYGON((#{lng} #{lat}, #{lng + offset} #{lat}, #{lng + offset} #{lat + offset}, #{lng} #{lat + offset}, #{lng} #{lat}))"
      end
    end

    trait :linestring do
      boundary do
        # Create a simple line
        lng1 = Faker::Address.longitude.to_f
        lat1 = Faker::Address.latitude.to_f
        lng2 = lng1 + 0.001
        lat2 = lat1 + 0.001
        
        "LINESTRING(#{lng1} #{lat1}, #{lng2} #{lat2})"
      end
    end
  end
end