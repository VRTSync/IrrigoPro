# Rails KML Uploader

A standalone Ruby on Rails application for processing and visualizing KML files containing irrigation controller and zone data.

## Tech Stack

- **Ruby on Rails 7.1+**
- **PostgreSQL with PostGIS** for geospatial data
- **Redis** for caching and job processing
- **AWS EC2** for compute
- **AWS RDS** for managed PostgreSQL
- **Stimulus** for JavaScript interactions
- **Turbo** for SPA-like experience
- **Nokogiri** for XML/KML parsing

## Features

- Drag & drop KML file upload
- Real-time KML parsing and validation
- Geospatial data storage with PostGIS
- Interactive map visualization with Leaflet
- Controller and zone management
- AWS S3 integration for file storage
- Background job processing with Sidekiq

## Setup

1. Install dependencies:
```bash
bundle install
```

2. Setup database:
```bash
rails db:create
rails db:migrate
```

3. Start Redis:
```bash
redis-server
```

4. Start Sidekiq:
```bash
bundle exec sidekiq
```

5. Start Rails server:
```bash
rails server
```

## Environment Variables

```bash
DATABASE_URL=postgresql://user:pass@localhost/kml_uploader_development
REDIS_URL=redis://localhost:6379/0
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1
S3_BUCKET=your-kml-files-bucket
```

## Architecture

- **Models**: Controller, Zone, KmlFile with PostGIS geometry columns
- **Services**: KmlParserService for processing uploaded files
- **Jobs**: KmlProcessingJob for background file processing
- **Controllers**: KmlFilesController for upload handling
- **Views**: Stimulus-powered interface with Leaflet maps