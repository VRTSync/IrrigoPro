export {};

declare module "express-session" {
  interface SessionData {
    userId?: number;
    companyId?: number;
    role?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUserId?: number;
      authenticatedUserRole?: string;
      authenticatedUserCompanyId?: number | null;
      // Legacy session-derived field set by ad-hoc middleware in routes.ts;
      // routes typically prefer authenticatedUserCompanyId. Declared here so
      // extracted route modules can read it without `as any` casts.
      userCompanyId?: number | null;
      user?: { id: number; email: string; [key: string]: unknown };
      files?: Record<string, { data: Buffer; name: string; size: number; mimetype: string }>;
      // Populated by requireSameCompanyAsWorkOrder middleware so downstream
      // handlers can reuse the loaded row without a second DB round-trip.
      tenantScopedWorkOrder?: Record<string, unknown>;
    }
  }
}
