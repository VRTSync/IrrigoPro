import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";

test("work-order zone writes enforce the edit role and technician assignment", async (t) => {
  // Use a missing item fixture to distinguish reaching storage (404) from
  // being denied by the role guard (403), without writing to a database.
  const completeItem = t.mock.fn(async (_workOrderId: number, _itemId: number, _completed: boolean) => undefined);
  const attachPhoto = t.mock.fn(async () => {
    throw new Error("A bookkeeper must not reach photo storage");
  });
  const deletePhoto = t.mock.fn(async () => false);
  // Mock before import: the real storage constructor runs startup migrations.
  t.mock.module("../storage", {
    namedExports: {
      storage: {
        setWorkOrderItemCompletion: completeItem,
        attachWorkOrderZonePhoto: attachPhoto,
        deleteWorkOrderZonePhoto: deletePhoto,
      },
    },
  });
  const { registerWorkOrderZoneRoutes } = await import("./work-order-zone-route");

  const app = express();
  app.use(express.json());
  registerWorkOrderZoneRoutes(app, {
    requireAuthentication(req, _res, next) {
      req.authenticatedUserRole = req.header("x-test-role");
      req.authenticatedUserId = Number(req.header("x-test-user"));
      next();
    },
    requireSameCompanyAsWorkOrder(req, _res, next) {
      req.tenantScopedWorkOrder = { assignedTechnicianId: 7 };
      next();
    },
  });

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const matrix = [
    { role: "bookkeeper", userId: 7, allowed: false },
    { role: "field_tech", userId: 7, allowed: true },
    { role: "field_tech", userId: 8, allowed: false },
    { role: "company_admin", userId: 8, allowed: true },
    { role: "billing_manager", userId: 8, allowed: true },
    { role: "irrigation_manager", userId: 8, allowed: true },
    { role: "super_admin", userId: 8, allowed: true },
  ];
  for (const { role, userId, allowed } of matrix) {
    await t.test(`item completion: ${role} (user ${userId}) ${allowed ? "can edit" : "is denied"}`, async () => {
      completeItem.mock.resetCalls();
      const response = await fetch(`http://127.0.0.1:${port}/api/work-orders/12/items/34/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-test-role": role, "x-test-user": String(userId) },
        body: JSON.stringify({ completed: true }),
      });

      assert.equal(response.status, allowed ? 404 : 403);
      assert.deepEqual(completeItem.mock.calls.map((call) => call.arguments), allowed ? [[12, 34, true]] : []);
      assert.deepEqual(await response.json(), {
        message: allowed ? "Work order item not found"
          : role === "field_tech" ? "You can only update a work order assigned to you."
          : "Your role cannot update work order items.",
      });
    });
  }

  await t.test("bookkeepers cannot attach or delete zone photos", async () => {
    const headers = { "Content-Type": "application/json", "x-test-role": "bookkeeper", "x-test-user": "7" };
    const photoUrl = `http://127.0.0.1:${port}/api/work-orders/12/zone-photos`;
    const post = await fetch(photoUrl, {
      method: "POST", headers, body: JSON.stringify({ url: "photos/test-photo" }),
    });
    const remove = await fetch(`${photoUrl}/56`, { method: "DELETE", headers });

    for (const response of [post, remove]) {
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { message: "Your role cannot update work order items." });
    }
    assert.equal(attachPhoto.mock.callCount(), 0);
    assert.equal(deletePhoto.mock.callCount(), 0);
  });
});
