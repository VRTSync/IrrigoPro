import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canManageUser, selfProfilePatch, toPublicUser } from "./user-access";

const companyAdmin = { id: 1, role: "company_admin", companyId: 1 };
const peerAdmin = { ...companyAdmin, id: 2 };
const foreignAdmin = { ...companyAdmin, id: 3, companyId: 2 };
const tech = { id: 4, role: "field_tech", companyId: 1 };
const superAdmin = { id: 5, role: "super_admin", companyId: null };

describe("toPublicUser", () => {
  it("keeps directory fields, removing all eight private fields without mutating the row", () => {
    const publicFields = { ...tech, name: "Test Technician", email: "tech@example.com", isActive: true };
    const privateFields = {
      password: "hash",
      mfaSecret: "secret",
      mfaBackupCodes: "codes",
      passwordResetToken: "reset",
      passwordResetExpires: new Date(0),
      emailVerificationToken: "verification",
      emailVerificationExpires: new Date(0),
      hourlyWage: "20.00",
    };
    const row = { ...publicFields, ...privateFields };
    assert.deepEqual(toPublicUser(row), publicFields);
    assert.deepEqual(row, { ...publicFields, ...privateFields });
  });
});

describe("canManageUser", () => {
  it("returns not_found for a missing target before checking the caller's role", () => {
    for (const caller of [tech, companyAdmin, superAdmin]) {
      assert.equal(canManageUser(caller, undefined, "manage"), "not_found");
    }
  });

  it("lets super admins manage users across companies, but not delete or deactivate themselves", () => {
    for (const action of ["manage", "delete", "deactivate"] as const) {
      assert.equal(canManageUser(superAdmin, foreignAdmin, action), "ok");
    }
    assert.equal(canManageUser(superAdmin, superAdmin, "manage"), "ok");
    assert.equal(canManageUser(superAdmin, superAdmin, "delete"), "forbidden");
    assert.equal(canManageUser(superAdmin, superAdmin, "deactivate"), "forbidden");
  });

  it("forbids non-admins from managing users, including themselves", () => {
    for (const action of ["manage", "delete", "deactivate"] as const) {
      assert.equal(canManageUser(tech, peerAdmin, action), "forbidden");
      assert.equal(canManageUser(tech, tech, action), "forbidden");
    }
  });

  it("conceals foreign users and super admins from company admins", () => {
    for (const action of ["manage", "delete", "deactivate"] as const) {
      assert.equal(canManageUser(companyAdmin, foreignAdmin, action), "not_found");
      assert.equal(canManageUser(companyAdmin, { ...superAdmin, companyId: 1 }, action), "not_found");
    }
  });

  it("lets company admins manage peers, but not delete or deactivate themselves", () => {
    for (const action of ["manage", "delete", "deactivate"] as const) {
      assert.equal(canManageUser(companyAdmin, peerAdmin, action), "ok");
    }
    assert.equal(canManageUser(companyAdmin, companyAdmin, "manage"), "ok");
    assert.equal(canManageUser(companyAdmin, companyAdmin, "delete"), "forbidden");
    assert.equal(canManageUser(companyAdmin, companyAdmin, "deactivate"), "forbidden");
  });
});

describe("selfProfilePatch", () => {
  it("accepts and trims name and email, independently or together", () => {
    const name = "Test Technician";
    const email = "tech@example.com";
    assert.deepEqual(selfProfilePatch.parse({ name: ` ${name} ` }), { name });
    assert.deepEqual(selfProfilePatch.parse({ email: ` ${email} ` }), { email });
    assert.deepEqual(selfProfilePatch.parse({ name, email }), { name, email });
  });

  it("rejects any field other than name and email", () => {
    for (const [key, value] of Object.entries({
      role: "super_admin",
      companyId: 2,
      password: "different-password",
      isActive: false,
      mfaEnabled: true,
      username: "different-login",
    })) {
      const result = selfProfilePatch.safeParse({ name: "Test Technician", [key]: value });
      assert.equal(result.success, false, key);
      assert.equal(result.error?.issues[0]?.code, "unrecognized_keys", key);
    }
  });

  it("rejects a blank or oversized name and an invalid email", () => {
    for (const input of [{ name: " " }, { name: "a".repeat(201) }, { email: "not-an-email" }]) {
      assert.equal(selfProfilePatch.safeParse(input).success, false);
    }
  });
});
