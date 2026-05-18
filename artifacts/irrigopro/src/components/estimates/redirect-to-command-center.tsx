import { useEffect } from "react";
import { useLocation } from "wouter";

export default function RedirectToCommandCenter() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/estimates/command-center", { replace: true });
  }, [setLocation]);
  return null;
}
