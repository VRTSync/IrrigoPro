// Production environment configuration
export const PRODUCTION_CONFIG = {
  // Security settings
  JWT_SECRET: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set in production');
    }
    return 'development-fallback-secret';
  })(),
  
  JWT_EXPIRY: process.env.JWT_EXPIRY || '24h',
  
  // Domain settings
  PRODUCTION_DOMAIN: 'https://irrigopro.com',
  
  // Database settings
  DATABASE_POOL_SIZE: parseInt(process.env.DATABASE_POOL_SIZE || '10'),
  
  // Rate limiting
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '900000'), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  
  // Session settings
  SESSION_SECRET: process.env.SESSION_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET must be set in production');
    }
    return 'development-session-secret';
  })(),
  
  SESSION_DURATION: parseInt(process.env.SESSION_DURATION || '86400000'), // 24 hours
  
  // Security headers
  SECURITY_HEADERS: {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https:;",
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  },
  
  // CORS settings
  CORS_OPTIONS: {
    origin: process.env.NODE_ENV === 'production' 
      ? ['https://irrigopro.com', 'https://www.irrigopro.com']
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
    maxAge: 86400 // 24 hours
  },
  
  // Email settings
  EMAIL_SETTINGS: {
    FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@irrigopro.com',
    SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@irrigopro.com',
    REPLY_TO_EMAIL: process.env.REPLY_TO_EMAIL || 'support@irrigopro.com'
  },
  
  // File upload limits
  UPLOAD_LIMITS: {
    MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // 50MB
    ALLOWED_MIME_TYPES: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  },
  
  // Logging configuration
  LOGGING: {
    LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
    FILE_ENABLED: process.env.LOG_FILE_ENABLED === 'true',
    FILE_PATH: process.env.LOG_FILE_PATH || './logs/app.log',
    MAX_FILES: parseInt(process.env.LOG_MAX_FILES || '5'),
    MAX_SIZE: process.env.LOG_MAX_SIZE || '10m'
  }
};

// Validate production environment
export function validateProductionConfig() {
  if (process.env.NODE_ENV !== 'production') {
    return; // Skip validation in development
  }

  const requiredEnvVars = [
    'JWT_SECRET',
    'SESSION_SECRET',
    'DATABASE_URL',
    'POSTMARK_API_TOKEN'
  ];

  const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables for production: ${missing.join(', ')}`);
  }

  console.log('✅ Production configuration validated');
}

// Environment detection
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
}

// URL helpers for production/development
export function getBaseUrl(): string {
  if (isProduction()) {
    return PRODUCTION_CONFIG.PRODUCTION_DOMAIN;
  }
  
  // Development URL construction
  const replSlug = process.env.REPL_SLUG;
  const replId = process.env.REPL_ID;
  const replitCluster = process.env.REPLIT_CLUSTER;
  
  if (replSlug && replId && replitCluster) {
    return `https://${replSlug}-00-${replId}.${replitCluster}.replit.dev`;
  }
  
  return 'http://localhost:5000';
}

export default PRODUCTION_CONFIG;