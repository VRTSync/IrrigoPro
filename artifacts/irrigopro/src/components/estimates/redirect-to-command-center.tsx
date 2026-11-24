import { Redirect } from "wouter";

export default function RedirectToCommandCenter() {
  return <Redirect to="/estimates/command-center" replace />;
}
