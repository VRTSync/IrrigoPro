class CreateZones < ActiveRecord::Migration[7.1]
  def change
    create_table :zones do |t|
      t.references :controller, null: false, foreign_key: true
      t.string :name, null: false
      t.integer :station_number, null: false
      t.geometry :boundary, limit: {srid: 4326}
      t.integer :zone_type, default: 0
      t.text :coverage
      t.text :description

      t.timestamps
    end

    add_index :zones, :boundary, using: :gist
    add_index :zones, :name
    add_index :zones, :station_number
    add_index :zones, [:controller_id, :station_number], unique: true
  end
end