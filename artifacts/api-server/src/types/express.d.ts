export {};

declare global {
  namespace Express {
    interface Request {
      session: Record<string, unknown> & {
        userId?: number;
        companyId?: number;
        role?: string;
        destroy(callback: (err?: Error) => void): void;
        save(callback?: (err?: Error) => void): void;
      };
      authenticatedUserId?: number;
      authenticatedUserRole?: string;
      authenticatedUserCompanyId?: number | null;
      // Legacy session-derived field set by ad-hoc middleware in routes.ts;
      // routes typically prefer authenticatedUserCompanyId. Declared here so
      // extracted route modules can read it without `as any` casts.
      userCompanyId?: number | null;
      user?: { id: number; email: string; [key: string]: unknown };
      files?: Record<string, { data: Buffer; name: string; size: number; mimetype: string }>;
    }
  }
}
