import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import fileUpload from "express-fileupload";
import type { Server } from "http";

export async function createApp(): Promise<{ app: Express; httpServer: Server }> {
  const app: Express = express();

  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: false,
  }));

  const httpServer = await registerRoutes(app);
  return { app, httpServer };
}
