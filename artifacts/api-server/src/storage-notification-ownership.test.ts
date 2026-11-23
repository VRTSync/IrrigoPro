import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, inArray } from "drizzle-orm";
import { companies, notifications, users } from "@workspace/db";
import { db } from "./db";
import { storage } from "./storage";

test("markNotificationAsRead only updates the recipient's notification", async (t) => {
  const fixture = `notification-test-${randomUUID()}`;
  const [company] = await db.insert(companies).values({ name: fixture }).returning({ id: companies.id });
  const userIds: number[] = [];
  let notificationId: number | undefined;
  t.after(async () => {
    if (notificationId !== undefined) await db.delete(notifications).where(eq(notifications.id, notificationId));
    if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(companies).where(eq(companies.id, company.id));
  });

  const [owner, otherUser] = await db.insert(users).values(["owner", "other"].map((name) => ({
    username: `${fixture}-${name}`,
    password: "not-a-login",
    name,
    companyId: company.id,
    isActive: false,
  }))).returning({ id: users.id });
  userIds.push(owner.id, otherUser.id);

  const notification = await storage.createNotification({
    userId: owner.id,
    type: "work_order_assigned",
    title: "Test notification",
    message: "Test notification",
    isRead: false,
  });
  notificationId = notification.id;

  const getReadStatus = async () => {
    const [row] = await db.select({ isRead: notifications.isRead }).from(notifications).where(eq(notifications.id, notification.id));
    return row?.isRead;
  };

  assert.equal(await storage.markNotificationAsRead(notification.id, otherUser.id), false);
  assert.equal(await getReadStatus(), false);
  assert.equal(await storage.markNotificationAsRead(notification.id, owner.id), true);
  assert.equal(await getReadStatus(), true);
});
