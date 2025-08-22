class CreateKmlFiles < ActiveRecord::Migration[7.1]
  def change
    create_table :kml_files do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.integer :status, default: 0
      t.integer :controllers_count, default: 0
      t.integer :zones_count, default: 0
      t.text :error_message
      t.datetime :processed_at

      t.timestamps
    end

    add_index :kml_files, :status
    add_index :kml_files, :created_at
    add_index :kml_files, [:user_id, :created_at]
  end
end