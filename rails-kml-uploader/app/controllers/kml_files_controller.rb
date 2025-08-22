class KmlFilesController < ApplicationController
  before_action :set_kml_file, only: [:show, :preview, :map_data, :destroy]
  
  def index
    @kml_files = current_user.kml_files.recent.includes(:controllers, :zones)
    @kml_files = @kml_files.page(params[:page])
    
    respond_to do |format|
      format.html
      format.json { render json: @kml_files }
    end
  end

  def show
    @controllers = @kml_file.controllers.includes(:zones)
    @zones = @kml_file.zones.includes(:controller)
    
    respond_to do |format|
      format.html
      format.json do
        render json: {
          kml_file: @kml_file,
          controllers: @controllers.map(&:to_geojson),
          zones: @zones.map(&:to_geojson),
          bounds: @kml_file.bounds,
          center: @kml_file.center_coordinates
        }
      end
    end
  end

  def upload
    unless current_user.can_upload_kml?
      return render json: { error: 'Unauthorized to upload KML files' }, status: :forbidden
    end

    @kml_file = current_user.kml_files.build(kml_file_params)
    
    if @kml_file.save
      render json: { 
        kml_file: @kml_file,
        message: 'KML file uploaded successfully. Processing in background.',
        redirect_url: kml_file_path(@kml_file)
      }, status: :created
    else
      render json: { 
        errors: @kml_file.errors.full_messages 
      }, status: :unprocessable_entity
    end
  end

  def preview
    if @kml_file.processing_complete?
      render json: {
        status: @kml_file.status,
        controllers_count: @kml_file.controllers_count,
        zones_count: @kml_file.zones_count,
        error_message: @kml_file.error_message
      }
    else
      render json: {
        status: @kml_file.status,
        message: 'File is still processing...'
      }
    end
  end

  def map_data
    if @kml_file.completed?
      controllers_geojson = Controller.to_geojson_collection(@kml_file.controllers.includes(:zones))
      zones_geojson = Zone.to_geojson_collection(@kml_file.zones.includes(:controller))
      
      render json: {
        controllers: controllers_geojson,
        zones: zones_geojson,
        bounds: @kml_file.bounds,
        center: @kml_file.center_coordinates
      }
    else
      render json: { 
        error: 'KML file not ready for map display',
        status: @kml_file.status 
      }, status: :unprocessable_entity
    end
  end

  def parse_status
    kml_file_id = params[:kml_file_id]
    kml_file = current_user.kml_files.find(kml_file_id)
    
    render json: {
      id: kml_file.id,
      status: kml_file.status,
      controllers_count: kml_file.controllers_count,
      zones_count: kml_file.zones_count,
      error_message: kml_file.error_message,
      processing_complete: kml_file.processing_complete?
    }
  end

  def destroy
    unless current_user.can_delete_data?
      return redirect_to kml_files_path, alert: 'Unauthorized to delete KML files'
    end

    @kml_file.destroy
    redirect_to kml_files_path, notice: 'KML file deleted successfully'
  end

  private

  def set_kml_file
    @kml_file = current_user.kml_files.find(params[:id])
  end

  def kml_file_params
    params.require(:kml_file).permit(:name, :file)
  end
end