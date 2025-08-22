class Api::V1::KmlFilesController < Api::V1::BaseController
  before_action :set_kml_file, only: [:show, :geojson]

  def index
    @kml_files = current_user.kml_files.recent.includes(:controllers, :zones)
    @kml_files = @kml_files.page(params[:page])

    render json: {
      kml_files: @kml_files.map do |kml_file|
        {
          id: kml_file.id,
          name: kml_file.name,
          status: kml_file.status,
          controllers_count: kml_file.controllers_count,
          zones_count: kml_file.zones_count,
          file_size: kml_file.file_size_humanized,
          created_at: kml_file.created_at,
          processed_at: kml_file.processed_at
        }
      end,
      meta: pagination_meta(@kml_files)
    }
  end

  def show
    render json: {
      kml_file: {
        id: @kml_file.id,
        name: @kml_file.name,
        status: @kml_file.status,
        controllers_count: @kml_file.controllers_count,
        zones_count: @kml_file.zones_count,
        bounds: @kml_file.bounds,
        center: @kml_file.center_coordinates,
        created_at: @kml_file.created_at,
        processed_at: @kml_file.processed_at,
        error_message: @kml_file.error_message
      },
      controllers: @kml_file.controllers.map(&:to_geojson),
      zones: @kml_file.zones.map(&:to_geojson)
    }
  end

  def create
    unless current_user.can_upload_kml?
      return render json: { error: 'Unauthorized to upload KML files' }, status: :forbidden
    end

    @kml_file = current_user.kml_files.build(kml_file_params)

    if @kml_file.save
      render json: {
        kml_file: {
          id: @kml_file.id,
          name: @kml_file.name,
          status: @kml_file.status
        },
        message: 'KML file uploaded successfully'
      }, status: :created
    else
      render json: { errors: @kml_file.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def geojson
    if @kml_file.completed?
      controllers_geojson = Controller.to_geojson_collection(@kml_file.controllers)
      zones_geojson = Zone.to_geojson_collection(@kml_file.zones)

      render json: {
        type: "FeatureCollection",
        features: controllers_geojson[:features] + zones_geojson[:features],
        metadata: {
          bounds: @kml_file.bounds,
          center: @kml_file.center_coordinates,
          controllers_count: @kml_file.controllers_count,
          zones_count: @kml_file.zones_count
        }
      }
    else
      render json: { 
        error: 'KML file not ready', 
        status: @kml_file.status 
      }, status: :unprocessable_entity
    end
  end

  private

  def set_kml_file
    @kml_file = current_user.kml_files.find(params[:id])
  end

  def kml_file_params
    params.require(:kml_file).permit(:name, :file)
  end
end