Rails.application.routes.draw do
  devise_for :users
  root "kml_files#index"

  resources :kml_files do
    member do
      get :preview
      get :map_data
    end
    
    collection do
      post :upload
      get :parse_status
    end
  end

  resources :controllers, only: [:index, :show, :destroy] do
    resources :zones, only: [:index, :show, :destroy]
  end

  namespace :api do
    namespace :v1 do
      resources :kml_files, only: [:create, :show, :index] do
        member do
          get :geojson
        end
      end
      
      resources :controllers, only: [:index, :show] do
        resources :zones, only: [:index, :show]
      end
    end
  end

  # Health check endpoint
  get "health", to: "application#health"
  
  # Sidekiq monitoring (admin only)
  require 'sidekiq/web'
  mount Sidekiq::Web => '/sidekiq'
end