# Use Ruby 3.2 as base image
FROM ruby:3.2.0-slim

# Install system dependencies
RUN apt-get update -qq && \
    apt-get install -y \
    build-essential \
    libpq-dev \
    postgresql-client \
    nodejs \
    npm \
    git \
    curl \
    imagemagick \
    libvips42 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Gemfile and install gems
COPY Gemfile Gemfile.lock ./
RUN bundle config --global frozen 1 && \
    bundle install --without development test

# Copy application code
COPY . .

# Precompile assets
RUN bundle exec rails assets:precompile

# Create user for running the application
RUN groupadd --gid 1000 rails && \
    useradd --uid 1000 --gid rails --shell /bin/bash --create-home rails && \
    chown -R rails:rails /app

USER rails

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["bundle", "exec", "rails", "server", "-b", "0.0.0.0"]