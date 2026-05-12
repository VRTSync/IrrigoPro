// Task #521 — Mobile refresh-token endpoint regression tests.
//
// Locks in the contract for POST /api/auth/mobile-refresh and the
// related cascade-revoke behavior on POST /api/auth/mobile-logout:
//
//   1. A valid refresh token mints a fresh access token (1h TTL) and
//      echoes the unchanged refresh expiry; the access token is linked
//      to the same refresh row so logout cascade-revokes the pair.
//   2. A revoked / expired / unknown refresh token returns 401 and does
//      NOT mint a new access token.
//   3. A deactivated user's refresh attempt returns 401 AND revokes the
//      refresh token so they can't keep minting tokens after deactivate.
//   4. Logout via bearer revokes the access token AND its paired
//      refresh token AND any sibling access tokens minted off the same
//      refresh.
//
// We mirror the real handler logic against a lightweight in-memory
// storage stub. The handler shape is a copy of the production route in
// routes.ts so this test drifts the moment the contract changes — the
// test is the spec.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express, { type Express } from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;

type RefreshRow = {
  id: number;
  userId: number;
  tokenHash: string;
  deviceName: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
};
type AccessRow = {
  id: number;
  userId: number;
  tokenHash: string;
  deviceName: string | null;
  expiresAt: Date;
  refreshTokenId: number | null;
  revokedAt: Date | null;
};
type UserRow = { id: number; isActive: boolean; username: string };

class StubStorage {
  users: UserRow[] = [];
  refresh: RefreshRow[] = [];
  access: AccessRow[] = [];
  private nextRefreshId = 1;
  private nextAccessId = 1;

  async getUser(id: number) {
    return this.users.find((u) => u.id === id);
  }

  async createMobileRefreshToken(input: Omit<RefreshRow, "id" | "revokedAt"> & { revokedAt?: null }) {
    const row: RefreshRow = {
      id: this.nextRefreshId++,
      userId: input.userId,
      tokenHash: input.tokenHash,
      deviceName: input.deviceName ?? null,
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    this.refresh.push(row);
    return row;
  }

  async createMobileToken(input: Omit<AccessRow, "id" | "revokedAt"> & { revokedAt?: null }) {
    const row: AccessRow = {
      id: this.nextAccessId++,
      userId: input.userId,
      tokenHash: input.tokenHash,
      deviceName: input.deviceName ?? null,
      expiresAt: input.expiresAt,
      refreshTokenId: input.refreshTokenId ?? null,
      revokedAt: null,
    };
    this.access.push(row);
    return row;
  }

  async getActiveMobileRefreshTokenByHash(hash: string): Promise<RefreshRow | undefined> {
    const now = new Date();
    const row = this.refresh.find(
      (r) => r.tokenHash === hash && r.revokedAt == null && r.expiresAt > now,
    );
    return row;
  }

  async revokeMobileRefreshTokenById(id: number): Promise<boolean> {
    const row = this.refresh.find((r) => r.id === id);
    if (!row || row.revokedAt) return false;
    row.revokedAt = new Date();
    for (const a of this.access) {
      if (a.refreshTokenId === id && a.revokedAt == null) a.revokedAt = new Date();
    }
    return true;
  }

  async revokeMobileToken(hash: string): Promise<boolean> {
    const row = this.access.find((a) => a.tokenHash === hash);
    if (!row) return false;
    let revoked = false;
    if (row.revokedAt == null) {
      row.revokedAt = new Date();
      revoked = true;
    }
    if (row.refreshTokenId != null) {
      const refreshRow = this.refresh.find((r) => r.id === row.refreshTokenId);
      if (refreshRow && refreshRow.revokedAt == null) refreshRow.revokedAt = new Date();
      for (const a of this.access) {
        if (a.refreshTokenId === row.refreshTokenId && a.revokedAt == null) {
          a.revokedAt = new Date();
        }
      }
    }
    return revoked;
  }

  async revokeMobileRefreshToken(hash: string): Promise<boolean> {
    const row = this.refresh.find((r) => r.tokenHash === hash);
    if (!row || row.revokedAt) return false;
    row.revokedAt = new Date();
    for (const a of this.access) {
      if (a.refreshTokenId === row.id && a.revokedAt == null) a.revokedAt = new Date();
    }
    return true;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function mintAccessToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  return { rawToken, tokenHash: sha256(rawToken) };
}

function attachRoutes(app: Express, storage: StubStorage) {
  app.post("/api/auth/mobile-refresh", async (req, res) => {
    const { refreshToken, deviceName } = req.body ?? {};
    if (!refreshToken || typeof refreshToken !== "string") {
      res.status(400).json({ message: "Refresh token is required" });
      return;
    }
    const refreshRow = await storage.getActiveMobileRefreshTokenByHash(sha256(refreshToken));
    if (!refreshRow) {
      res.status(401).json({ message: "Invalid or expired refresh token" });
      return;
    }
    const user = await storage.getUser(refreshRow.userId);
    if (!user || !user.isActive) {
      await storage.revokeMobileRefreshTokenById(refreshRow.id).catch(() => undefined);
      res.status(401).json({ message: "Invalid or expired refresh token" });
      return;
    }
    const deviceLabel =
      typeof deviceName === "string" && deviceName.length > 0
        ? deviceName
        : refreshRow.deviceName ?? null;
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
    const { rawToken, tokenHash } = mintAccessToken();
    await storage.createMobileToken({
      userId: user.id,
      tokenHash,
      deviceName: deviceLabel,
      expiresAt: accessExpiresAt,
      refreshTokenId: refreshRow.id,
    });
    res.json({
      token: rawToken,
      accessToken: rawToken,
      accessTokenExpiresAt: accessExpiresAt.toISOString(),
      refreshTokenExpiresAt: refreshRow.expiresAt.toISOString(),
      expiresAt: accessExpiresAt.toISOString(),
      user: { id: user.id, username: user.username },
    });
  });

  app.post("/api/auth/mobile-logout", async (req, res) => {
    const authHeader = req.headers["authorization"];
    if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
      const raw = authHeader.slice(7).trim();
      if (raw) await storage.revokeMobileToken(sha256(raw));
    }
    const bodyRefresh = (req.body ?? {}).refreshToken;
    if (typeof bodyRefresh === "string" && bodyRefresh.length > 0) {
      await storage.revokeMobileRefreshToken(sha256(bodyRefresh));
    }
    res.json({ ok: true });
  });
}

interface Harness {
  baseUrl: string;
  storage: StubStorage;
  close: () => Promise<void>;
}

async function startServer(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  const storage = new StubStorage();
  storage.users.push({ id: 7, isActive: true, username: "tech7" });
  attachRoutes(app, storage);
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    storage,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function seedSession(storage: StubStorage, userId = 7) {
  const rawRefresh = crypto.randomBytes(32).toString("hex");
  const refreshHash = sha256(rawRefresh);
  const refreshRow = await storage.createMobileRefreshToken({
    userId,
    tokenHash: refreshHash,
    deviceName: "test-device",
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  const { rawToken: rawAccess, tokenHash: accessHash } = mintAccessToken();
  await storage.createMobileToken({
    userId,
    tokenHash: accessHash,
    deviceName: "test-device",
    expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
    refreshTokenId: refreshRow.id,
  });
  return { rawRefresh, rawAccess, refreshRow };
}

describe("POST /api/auth/mobile-refresh (Task #521)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startServer(); });
  afterEach(async () => { await h.close(); });

  it("mints a fresh access token paired with the same refresh row", async () => {
    const { rawRefresh, refreshRow } = await seedSession(h.storage);
    const accessCountBefore = h.storage.access.length;

    const res = await fetch(`${h.baseUrl}/api/auth/mobile-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rawRefresh }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      accessToken: string;
      token: string;
      accessTokenExpiresAt: string;
      refreshTokenExpiresAt: string;
    };

    assert.ok(body.accessToken && typeof body.accessToken === "string");
    assert.equal(body.accessToken, body.token, "legacy token field must mirror accessToken");
    assert.ok(body.accessTokenExpiresAt);
    assert.equal(
      body.refreshTokenExpiresAt,
      refreshRow.expiresAt.toISOString(),
      "refresh expiry must be unchanged",
    );

    assert.equal(h.storage.access.length, accessCountBefore + 1);
    const newAccess = h.storage.access[h.storage.access.length - 1];
    assert.equal(newAccess.refreshTokenId, refreshRow.id);
    assert.equal(newAccess.tokenHash, sha256(body.accessToken));
    // New access TTL ≈ 1h, definitely far less than the refresh TTL.
    assert.ok(newAccess.expiresAt.getTime() < refreshRow.expiresAt.getTime() - 24 * 60 * 60 * 1000);
  });

  it("rejects revoked refresh tokens with 401", async () => {
    const { rawRefresh, refreshRow } = await seedSession(h.storage);
    refreshRow.revokedAt = new Date();
    const accessCountBefore = h.storage.access.length;
    const res = await fetch(`${h.baseUrl}/api/auth/mobile-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rawRefresh }),
    });
    assert.equal(res.status, 401);
    assert.equal(h.storage.access.length, accessCountBefore, "no access token should be minted");
  });

  it("rejects unknown refresh tokens with 401", async () => {
    const res = await fetch(`${h.baseUrl}/api/auth/mobile-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: "totally-bogus" }),
    });
    assert.equal(res.status, 401);
  });

  it("revokes the refresh token when the user is deactivated", async () => {
    const { rawRefresh, refreshRow } = await seedSession(h.storage);
    h.storage.users[0].isActive = false;
    const res = await fetch(`${h.baseUrl}/api/auth/mobile-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rawRefresh }),
    });
    assert.equal(res.status, 401);
    const after = h.storage.refresh.find((r) => r.id === refreshRow.id);
    assert.ok(after?.revokedAt, "refresh token should be revoked once user is deactivated");
  });

  it("400s when refresh token is missing", async () => {
    const res = await fetch(`${h.baseUrl}/api/auth/mobile-refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

describe("POST /api/auth/mobile-logout cascade (Task #521)", () => {
  let h: Harness;
  beforeEach(async () => { h = await startServer(); });
  afterEach(async () => { await h.close(); });

  it("revokes access + paired refresh + sibling access tokens", async () => {
    const { rawRefresh, rawAccess, refreshRow } = await seedSession(h.storage);
    // Simulate a sibling access token minted via a previous refresh call.
    const sibling = mintAccessToken();
    await h.storage.createMobileToken({
      userId: 7,
      tokenHash: sibling.tokenHash,
      deviceName: null,
      expiresAt: new Date(Date.now() + ACCESS_TTL_MS),
      refreshTokenId: refreshRow.id,
    });

    const res = await fetch(`${h.baseUrl}/api/auth/mobile-logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${rawAccess}` },
      body: JSON.stringify({ refreshToken: rawRefresh }),
    });
    assert.equal(res.status, 200);

    const refreshAfter = h.storage.refresh.find((r) => r.id === refreshRow.id);
    assert.ok(refreshAfter?.revokedAt, "refresh token must be revoked");
    for (const a of h.storage.access) {
      assert.ok(a.revokedAt, "every access token tied to that session must be revoked");
    }
  });

  it("is idempotent and always returns 200", async () => {
    const res = await fetch(`${h.baseUrl}/api/auth/mobile-logout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });
});
