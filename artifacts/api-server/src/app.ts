import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { registerRoutes } from "./routes/routes";
import marketingRouter from "./routes/marketing";
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
  // Global permissive CORS for the IrrigoPro app's same-origin frontend and
  // tooling. NOTE: /api/marketing-leads is intentionally exempted here so its
  // own strict per-route allowlist (artifacts/api-server/src/routes/marketing.ts)
  // is the only thing answering for that endpoint — otherwise this permissive
  // middleware would reflect any Origin and silently widen the marketing
  // allowlist.
  const globalCors = cors({ origin: true, credentials: true });
  app.use((req, res, next) => {
    if (req.path === "/api/marketing-leads") {
      return next();
    }
    return globalCors(req, res, next);
  });
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ extended: true, limit: "50mb" }));
  app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: false,
  }));

  app.use("/api", marketingRouter);
  const httpServer = await registerRoutes(app);
  return { app, httpServer };
}
