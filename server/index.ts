import express, { type Request, Response, NextFunction, ErrorRequestHandler } from "express";
import fileUpload from "express-fileupload";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { logger, createRequestLogger } from "./logger";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  abortOnLimit: true
}));

// Add request logging middleware
app.use(createRequestLogger);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  logger.info("Starting IrrigoPro server", "Server Startup", {
    environment: process.env.NODE_ENV,
    databaseAvailable: !!process.env.DATABASE_URL,
    version: "1.0.0"
  });
  
  console.log("Starting server...");
  console.log("Node environment:", process.env.NODE_ENV);
  console.log("Database URL available:", !!process.env.DATABASE_URL);
  
  let server;
  try {
    server = await registerRoutes(app);
    console.log("Routes registered successfully");
  } catch (error) {
    console.error("Failed to register routes:", error);
    logger.error("Failed to register routes", error, "Server Startup");
    throw error;
  }

  // Error handling middleware must come after route registration
  const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Log the error with full context
    logger.error(
      `Server error: ${message}`,
      err,
      `${req.method} ${req.path}`,
      {
        status,
        userId: (req as any).user?.id,
        requestBody: req.body,
        params: req.params,
        query: req.query
      }
    );

    res.status(status).json({ message });
  };
  
  app.use(errorHandler);



  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  
  // Validate port configuration
  if (isNaN(port) || port < 1 || port > 65535) {
    const errorMsg = `Invalid port configuration: ${process.env.PORT}. Port must be a number between 1 and 65535.`;
    console.error(errorMsg);
    logger.error(errorMsg, new Error('Invalid port configuration'), 'Server Startup');
    process.exit(1);
  }
  
  // Start server with simplified listen call and error handling
  server.listen(port, "0.0.0.0", () => {
    console.log(`Server successfully started on port ${port}`);
    log(`serving on port ${port}`);
    logger.info(`Server listening on port ${port}`, 'Server Startup', { port, host: '0.0.0.0', environment: process.env.NODE_ENV });
  }).on('error', (err) => {
    console.error('Server failed to start:', err);
    logger.error('Server failed to start', err, 'Server Startup', { port, host: '0.0.0.0' });
    process.exit(1);
  });
})();
