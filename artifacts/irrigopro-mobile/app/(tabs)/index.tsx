import React from "react";

import { FieldTechTodayScreen } from "@/components/field-tech-today-screen";
import { ManagerTodayScreen } from "@/components/manager-today-screen";
import { useAuth } from "@/lib/auth-context";

const MANAGER_ROLES = new Set(["irrigation_manager", "company_admin", "super_admin"]);

export default function TodayScreen() {
  const { user } = useAuth();
  if (user && MANAGER_ROLES.has(user.role)) {
    return <ManagerTodayScreen />;
  }
  return <FieldTechTodayScreen />;
}
