FactoryBot.define do
  factory :controller do
    association :kml_file
    name { "Controller #{Faker::Alphanumeric.alpha(number: 2).upcase}" }
    location { "POINT(#{Faker::Address.longitude} #{Faker::Address.latitude})" }
    description { Faker::Lorem.sentence }
    model { ['Hunter Pro-C', 'Rain Bird ESP-Me', 'Toro DDC', 'Irritrol KwikDial'].sample }
    serial_number { Faker::Alphanumeric.alphanumeric(number: 8).upcase }
    station_count { [6, 8, 12, 16].sample }

    trait :with_zones do
      after(:create) do |controller|
        create_list(:zone, 4, controller: controller)
      end
    end
  end
end