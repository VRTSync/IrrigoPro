class ControllersController < ApplicationController
  before_action :set_controller, only: [:show, :destroy]
  
  def index
    @kml_file = current_user.kml_files.find(params[:kml_file_id]) if params[:kml_file_id]
    
    @controllers = if @kml_file
                    @kml_file.controllers.includes(:zones, :kml_file)
                  else
                    current_user.controllers.includes(:zones, :kml_file)
                  end
    
    @controllers = @controllers.page(params[:page])
    
    respond_to do |format|
      format.html
      format.json { render json: Controller.to_geojson_collection(@controllers) }
    end
  end

  def show
    @zones = @controller.zones.includes(:controller)
    
    respond_to do |format|
      format.html
      format.json { render json: @controller.to_geojson }
    end
  end

  def destroy
    unless current_user.can_delete_data?
      return redirect_to controllers_path, alert: 'Unauthorized to delete controllers'
    end

    kml_file = @controller.kml_file
    @controller.destroy
    
    redirect_to kml_file_path(kml_file), notice: 'Controller deleted successfully'
  end

  private

  def set_controller
    @controller = current_user.controllers.find(params[:id])
  end
end