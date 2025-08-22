class KmlProcessingJob < ApplicationJob
  queue_as :default
  
  retry_on StandardError, wait: 10.seconds, attempts: 3
  
  def perform(kml_file)
    Rails.logger.info "Starting KML processing job for file: #{kml_file.name}"
    
    # Update status to processing
    kml_file.update!(status: :processing)
    
    # Parse and process the KML file
    parser = KmlParserService.new(kml_file)
    parser.parse!
    
    Rails.logger.info "KML processing job completed successfully for file: #{kml_file.name}"
    
    # Broadcast completion via ActionCable (if needed)
    broadcast_completion(kml_file)
    
  rescue StandardError => e
    Rails.logger.error "KML processing job failed for file: #{kml_file.name}"
    Rails.logger.error "Error: #{e.message}"
    Rails.logger.error e.backtrace.join("\n")
    
    kml_file.update!(
      status: :failed,
      error_message: "Processing failed: #{e.message}"
    )
    
    # Broadcast failure
    broadcast_failure(kml_file, e.message)
    
    # Re-raise to trigger retry mechanism
    raise e
  end

  private

  def broadcast_completion(kml_file)
    ActionCable.server.broadcast(
      "kml_processing_#{kml_file.user_id}",
      {
        type: 'processing_complete',
        kml_file_id: kml_file.id,
        status: 'completed',
        controllers_count: kml_file.controllers_count,
        zones_count: kml_file.zones_count,
        message: 'KML file processed successfully'
      }
    )
  rescue StandardError => e
    Rails.logger.error "Failed to broadcast completion: #{e.message}"
  end

  def broadcast_failure(kml_file, error_message)
    ActionCable.server.broadcast(
      "kml_processing_#{kml_file.user_id}",
      {
        type: 'processing_failed',
        kml_file_id: kml_file.id,
        status: 'failed',
        error_message: error_message,
        message: 'KML file processing failed'
      }
    )
  rescue StandardError => e
    Rails.logger.error "Failed to broadcast failure: #{e.message}"
  end
end