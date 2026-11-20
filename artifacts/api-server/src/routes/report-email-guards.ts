import type { RequestHandler } from "express";

export const isWetCheckManagerRole = (role: string | undefined) =>
  role === "irrigation_manager" || role === "company_admin" || role === "super_admin" || role === "billing_manager";

const PROFILE_MANAGER_ROLES = new Set(["company_admin", "super_admin", "irrigation_manager", "billing_manager"]);
export const isIrrigationProfileManagerRole = (role: string | undefined) => !!role && PROFILE_MANAGER_ROLES.has(role);

export const requireIrrigationProfileReportSend: RequestHandler = (req, res, next) => {
  if (!isIrrigationProfileManagerRole(req.authenticatedUserRole)) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  if (req.authenticatedUserRole !== "super_admin" && !req.authenticatedUserCompanyId) {
    res.status(401).json({ message: "Authentication required" });
    return;
  }
  next();
};

export const requireWetCheckReportSend: RequestHandler = (req, res, next) => {
  if (req.authenticatedUserRole !== "super_admin" && !req.authenticatedUserCompanyId) {
    res.status(403).json({ message: "Company scope required" });
    return;
  }
  if (!isWetCheckManagerRole(req.authenticatedUserRole)) {
    res.status(403).json({ message: "Access restricted to manager/admin/billing roles" });
    return;
  }
  next();
};
