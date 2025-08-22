class CreateControllers < ActiveRecord::Migration[7.1]
  def change
    create_table :controllers do |t|
      t.references :kml_file, null: false, foreign_key: true
      t.string :name, null: false
      t.geometry :location, limit: {srid: 4326, type: "point"}, null: false
      t.text :description
      t.string :model
      t.string :serial_number
      t.integer :station_count, default: 8

      t.timestamps
    end

    add_index :controllers, :location, using: :gist
    add_index :controllers, :name
    add_index :controllers, [:kml_file_id, :name]
  end
end