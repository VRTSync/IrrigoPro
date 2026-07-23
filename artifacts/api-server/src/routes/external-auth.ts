// Shared API-key middleware for all /api/external/* routes.
// Extracts and validates the Bearer token, attaches `req.apiKeyCompanyId`
// and `req.apiKeyId` on success, and short-circuits with an appropriate
// 401 on every failure path.

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { storage } from "../storage";

export function makeRequireApiKey(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({
        error: "UNAUTHORIZED",
        message: "API key required. Use Authorization: Bearer <your-api-key>",
      });
      return;
    }

    const apiKeyValue = authHeader.substring(7);

    const apiKey = await storage.getApiKeyByKey(apiKeyValue);

    if (!apiKey) {
      res.status(401).json({
        error: "INVALID_API_KEY",
        message: "Invalid or inactive API key",
      });
      return;
    }

    if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
      res.status(401).json({
        error: "API_KEY_EXPIRED",
        message: "API key has expired",
      });
      return;
    }

    await storage.updateApiKeyLastUsed(apiKey.id);

    req.apiKeyCompanyId = apiKey.companyId;
    req.apiKeyId = apiKey.id;

    next();
  };
}

export const requireApiKey = makeRequireApiKey();
