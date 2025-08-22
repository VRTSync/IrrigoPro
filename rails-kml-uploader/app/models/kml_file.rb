class KmlFile < ApplicationRecord
  belongs_to :user
  has_many :controllers, dependent: :destroy
  has_many :zones, through: :controllers
  
  has_one_attached :file

  validates :name, presence: true
  validates :file, presence: true
  validate :file_is_kml

  enum status: { 
    pending: 0, 
    processing: 1, 
    completed: 2, 
    failed: 3 
  }

  scope :recent, -> { order(created_at: :desc) }
  scope :by_user, ->(user) { where(user: user) }

  after_create :process_kml_file

  def file_size_humanized
    return "0 KB" unless file.attached?
    
    size = file.blob.byte_size
    units = %w[B KB MB GB TB]
    base = 1024
    
    return "#{size} B" if size < base
    
    exp = (Math.log(size) / Math.log(base)).floor
    exp = [exp, units.length - 1].min
    
    "#{(size.to_f / base**exp).round(1)} #{units[exp]}"
  end

  def center_coordinates
    return [37.7749, -122.4194] if controllers.empty? # San Francisco default
    
    lats = controllers.pluck("ST_Y(location)")
    lngs = controllers.pluck("ST_X(location)")
    
    [(lats.sum / lats.size), (lngs.sum / lngs.size)]
  end

  def bounds
    return default_bounds if controllers.empty?
    
    result = ApplicationRecord.connection.execute(
      "SELECT ST_Extent(location) as extent FROM controllers WHERE kml_file_id = #{id}"
    ).first
    
    return default_bounds unless result && result['extent']
    
    # Parse PostGIS BOX format: BOX(west south, east north)
    extent = result['extent']
    coords = extent.gsub(/BOX\(|\)/, '').split(',').map { |coord| coord.strip.split(' ').map(&:to_f) }
    
    {
      west: coords[0][0],
      south: coords[0][1], 
      east: coords[1][0],
      north: coords[1][1]
    }
  rescue
    default_bounds
  end

  def processing_complete?
    completed? || failed?
  end

  def error_details
    return nil unless failed?
    error_message || "Unknown processing error occurred"
  end

  private

  def file_is_kml
    return unless file.attached?
    
    unless file.content_type == 'application/vnd.google-earth.kml+xml' || 
           file.filename.extension.downcase == 'kml'
      errors.add(:file, 'must be a KML file')
    end
  end

  def process_kml_file
    KmlProcessingJob.perform_later(self)
  end

  def default_bounds
    {
      west: -122.5194,
      south: 37.7049,
      east: -122.3594,
      north: 37.8449
    }
  end
end