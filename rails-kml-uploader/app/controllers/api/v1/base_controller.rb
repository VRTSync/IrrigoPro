class Api::V1::BaseController < ApplicationController
  skip_before_action :verify_authenticity_token
  before_action :authenticate_api_user!

  respond_to :json

  rescue_from ActiveRecord::RecordNotFound do |e|
    render json: { error: 'Record not found' }, status: :not_found
  end

  rescue_from ActiveRecord::RecordInvalid do |e|
    render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
  end

  private

  def authenticate_api_user!
    # For now, use session-based authentication
    # In production, implement token-based authentication
    authenticate_user!
  end

  def pagination_meta(collection)
    {
      current_page: collection.current_page,
      total_pages: collection.total_pages,
      total_count: collection.total_count,
      per_page: collection.limit_value
    }
  end
end