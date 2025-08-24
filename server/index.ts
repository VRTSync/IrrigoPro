import express from "express";
import fileUpload from "express-fileupload";
import session from "express-session";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import initializeDatabase from "./db-init";
import { validateProductionConfig, PRODUCTION_CONFIG } from './production-config';

// Initialize the Express application
const app = express();

// Validate production environment configuration
try {
  validateProductionConfig();
} catch (error) {
  console.error('❌ Production configuration validation failed:', error);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

console.log("Initializing database connection...");
console.log("Environment:", process.env.NODE_ENV || "development");

// Initialize database
initializeDatabase().then(() => {
  console.log("Database connection initialized successfully");
}).catch((error: any) => {
  console.error("Failed to initialize database:", error);
  process.exit(1);
});

// Log environment info for debugging
console.log(`[INFO] ${new Date().toISOString()} - Starting IrrigoPro server (Server Startup)`);
console.log("Starting server...");
console.log("Node environment:", process.env.NODE_ENV || "development");
console.log("Database URL available:", !!process.env.DATABASE_URL);

// Parse JSON and URL-encoded data
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cookie parser for JWT tokens
app.use(cookieParser());

// File upload middleware
app.use(fileUpload({
  limits: { 
    fileSize: PRODUCTION_CONFIG.UPLOAD_LIMITS.MAX_FILE_SIZE,
    files: 5 
  },
  useTempFiles: true,
  tempFileDir: '/tmp/',
  abortOnLimit: true,
  responseOnLimit: 'File size limit exceeded',
  uploadTimeout: 60000
}));

// Session middleware for development compatibility
app.use(session({
  secret: PRODUCTION_CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: PRODUCTION_CONFIG.SESSION_DURATION
  }
}));

// Register all routes (includes security middleware)
registerRoutes(app).then(async (server) => {
  const port = parseInt(process.env.PORT || "5000");
  
  // Setup Vite development server for frontend
  if (process.env.NODE_ENV !== 'production') {
    const { setupVite } = await import('./vite');
    await setupVite(app, server);
  }
  
  server.listen(port, "0.0.0.0", () => {
    console.log(`✅ IrrigoPro server running on port ${port}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔒 Security: ${process.env.NODE_ENV === 'production' ? 'Production' : 'Development'}`);
    
    if (process.env.NODE_ENV === 'production') {
      console.log(`🚀 Production deployment ready at ${PRODUCTION_CONFIG.PRODUCTION_DOMAIN}`);
    } else {
      console.log(`🛠️  Development server running with fallback authentication`);
    }
  });
}).catch((error: any) => {
  console.error("Failed to register routes:", error);
  process.exit(1);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Unhandled error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
});

export default app;