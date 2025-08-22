class ZonesController < ApplicationController
  before_action :set_controller
  before_action :set_zone, only: [:show, :destroy]
  
  def index
    @zones = @controller.zones.includes(:controller)
    
    respond_to do |format|
      format.html
      format.json { render json: Zone.to_geojson_collection(@zones) }
    end
  end

  def show
    respond_to do |format|
      format.html
      format.json { render json: @zone.to_geojson }
    end
  end

  def destroy
    unless current_user.can_delete_data?
      return redirect_to controller_zones_path(@controller), alert: 'Unauthorized to delete zones'
    end

    @zone.destroy
    redirect_to controller_zones_path(@controller), notice: 'Zone deleted successfully'
  end

  private

  def set_controller
    @controller = current_user.controllers.find(params[:controller_id])
  end

  def set_zone
    @zone = @controller.zones.find(params[:id])
  end
end