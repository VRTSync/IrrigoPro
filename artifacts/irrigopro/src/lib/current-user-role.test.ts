import { afterEach, describe, expect, it } from "vitest";
import { readCurrentUserRole } from "./current-user-role";

afterEach(() => {
  localStorage.removeItem("user");
  sessionStorage.removeItem("user");
});

describe("shared estimate role reader", () => {
  it("reads local storage first, then session storage", () => {
    sessionStorage.setItem("user", JSON.stringify({ role: "field_tech" }));
    expect(readCurrentUserRole()).toBe("field_tech");
    localStorage.setItem("user", JSON.stringify({ role: "company_admin" }));
    expect(readCurrentUserRole()).toBe("company_admin");
  });

  it("denies missing, malformed, and unknown shapes", () => {
    expect(readCurrentUserRole()).toBeNull();
    sessionStorage.setItem("user", "{");
    expect(readCurrentUserRole()).toBeNull();
    sessionStorage.setItem("user", JSON.stringify({ role: 123 }));
    expect(readCurrentUserRole()).toBeNull();
  });
});