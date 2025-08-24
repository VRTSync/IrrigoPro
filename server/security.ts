import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { PRODUCTION_CONFIG } from './production-config';

// Security middleware configuration for production
export function configureSecurityMiddleware(app: express.Application) {
  
  // Helmet for security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'", "https:"],
        connectSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));

  // CORS configuration
  app.use(cors(PRODUCTION_CONFIG.CORS_OPTIONS));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: PRODUCTION_CONFIG.RATE_LIMIT_WINDOW,
    max: PRODUCTION_CONFIG.RATE_LIMIT_MAX_REQUESTS,
    message: {
      error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip rate limiting for authenticated requests with valid JWT
    skip: (req) => {
      return req.headers.authorization?.startsWith('Bearer ') || false;
    }
  });

  // Apply rate limiting to API routes
  app.use('/api/', limiter);

  // Additional security headers
  app.use((req, res, next) => {
    // Add custom security headers
    Object.entries(PRODUCTION_CONFIG.SECURITY_HEADERS).forEach(([header, value]) => {
      res.setHeader(header, value);
    });

    // Remove server fingerprinting
    res.removeHeader('X-Powered-By');
    
    // Add security headers for API responses
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    next();
  });

  // Trust proxy for production deployment (Replit)
  app.set('trust proxy', 1);

  console.log('✅ Security middleware configured');
}

// Input validation helpers
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return '';
  
  // Remove potential XSS vectors
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

// SQL injection prevention (additional layer beyond ORM)
export function validateSqlInput(input: string): boolean {
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
    /(;|\-\-|\/\*|\*\/)/,
    /(\b(OR|AND)\s+\w+\s*=\s*\w+)/i
  ];
  
  return !sqlPatterns.some(pattern => pattern.test(input));
}

// File upload security
export function validateFileUpload(file: any): { valid: boolean; error?: string } {
  // Check file size
  if (file.size > PRODUCTION_CONFIG.UPLOAD_LIMITS.MAX_FILE_SIZE) {
    return { 
      valid: false, 
      error: `File size exceeds limit of ${PRODUCTION_CONFIG.UPLOAD_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB` 
    };
  }

  // Check MIME type
  if (!PRODUCTION_CONFIG.UPLOAD_LIMITS.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return { 
      valid: false, 
      error: 'File type not allowed' 
    };
  }

  // Check file extension matches MIME type
  const allowedExtensions = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'application/pdf': ['.pdf'],
    'text/csv': ['.csv'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
  };

  const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  const expectedExtensions = allowedExtensions[file.mimetype as keyof typeof allowedExtensions];
  
  if (!expectedExtensions || !expectedExtensions.includes(fileExtension)) {
    return { 
      valid: false, 
      error: 'File extension does not match file type' 
    };
  }

  return { valid: true };
}

export default {
  configureSecurityMiddleware,
  sanitizeInput,
  validateSqlInput,
  validateFileUpload
};