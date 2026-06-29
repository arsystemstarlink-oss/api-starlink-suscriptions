import { jest } from "@jest/globals";
import * as mockRepos from "../helpers/mockRepositories.js";
import * as mockNotifService from "../helpers/mockNotificationService.js";
import * as mockCommService from "../helpers/mockCommunicationService.js";

jest.unstable_mockModule("../../infrastructure/firestore/repositories.js", () => mockRepos);
jest.unstable_mockModule("../../config/firebase.js", () => ({ ensureFirebaseInitialized: () => {} }));
jest.unstable_mockModule("../../infrastructure/websocket/websocketServer.js", () => ({ webSocketServer: { initialize: () => {}, shutdown: () => {}, broadcastCommunication: () => {}, broadcastCommunicationSent: () => {}, broadcastCommunicationReceived: () => {}, broadcastCommunicationFailed: () => {} } }));
jest.unstable_mockModule("../../services/cron/schedulerService.js", () => ({ schedulerService: { initialize: async () => {}, shutdown: () => {}, getStatus: () => ({ isRunning: false }), updateConfig: async (d: any) => d, getConfig: async () => null } }));
jest.unstable_mockModule("../../services/notifications/notificationService.js", () => mockNotifService);
jest.unstable_mockModule("../../services/communications/communicationService.js", () => mockCommService);

process.env.ORGANIZATION_ID = "test-org";
process.env.NODE_ENV = "test";
process.env.TWILIO_AUTH_TOKEN = "test-token-not-empty-so-validation-works-ok-ok";
process.env.TWILIO_WEBHOOK_URL = "https://test.example.com";

const { app } = await import("../../app.js");

import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = "starlink-api-dev-secret-key-change-in-prod-2026";

const makeAdminToken = (orgId = "test-org", userId = "admin-1") =>
  jwt.sign({ sub: userId, email: "admin@test.com", role: "admin", organizationId: orgId }, JWT_SECRET, { expiresIn: 3600 });

const makeClientToken = (orgId = "test-org", userId = "client-1", clientId = "client-id-1") =>
  jwt.sign({ sub: userId, email: "client@test.com", role: "client", clientId, organizationId: orgId }, JWT_SECRET, { expiresIn: 3600 });

const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("Integration: auth routes", () => {
  const adminToken = makeAdminToken();

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("POST /api/auth/login", () => {
    it("returns 200 and token for valid credentials", async () => {
      const passwordHash = await bcrypt.hash("password123", 10);
      await mockRepos.userRepository.create({
        organizationId: "test-org", email: "admin@test.com", passwordHash,
        name: "Admin", role: "admin" as any, isActive: true
      });
      const res = await request(app).post("/api/auth/login").send({ email: "admin@test.com", password: "password123" });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe("admin@test.com");
      expect(res.body.user).not.toHaveProperty("passwordHash");
    });

    it("returns 403 for wrong password", async () => {
      const passwordHash = await bcrypt.hash("correct-password", 10);
      await mockRepos.userRepository.create({
        organizationId: "test-org", email: "admin@test.com", passwordHash,
        name: "Admin", role: "admin" as any, isActive: true
      });
      const res = await request(app).post("/api/auth/login").send({ email: "admin@test.com", password: "wrong-password" });
      expect(res.status).toBe(403);
    });

    it("returns 400 for invalid email", async () => {
      const res = await request(app).post("/api/auth/login").send({ email: "bad", password: "password123" });
      expect(res.status).toBe(400);
    });

    it("returns 403 for inactive user", async () => {
      const passwordHash = await bcrypt.hash("password123", 10);
      await mockRepos.userRepository.create({
        organizationId: "test-org", email: "admin@test.com", passwordHash,
        name: "Admin", role: "admin" as any, isActive: false
      });
      const res = await request(app).post("/api/auth/login").send({ email: "admin@test.com", password: "password123" });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/auth/register", () => {
    it("creates user for admin", async () => {
      const res = await request(app).post("/api/auth/register")
        .set(authHeaders(adminToken))
        .send({ email: "new@test.com", password: "password123", name: "New", role: "admin" });
      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe("new@test.com");
    });

    it("creates client user with clientId", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Portal Client", phone: "+5841499", dni: "D-PORTAL", address: "Addr"
      });
      const res = await request(app).post("/api/auth/register")
        .set(authHeaders(adminToken))
        .send({ email: "portal@test.com", password: "password123", name: "Portal", role: "client", clientId: client.id });
      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe("client");
      expect(res.body.user.clientId).toBe(client.id);
    });

    it("returns 400 for client role without clientId", async () => {
      const res = await request(app).post("/api/auth/register")
        .set(authHeaders(adminToken))
        .send({ email: "noclient@test.com", password: "password123", name: "NoClientId", role: "client" });
      expect(res.status).toBe(400);
    });

    it("returns 403 without token", async () => {
      const res = await request(app).post("/api/auth/register").send({ email: "x@test.com", password: "password123", name: "X" });
      expect(res.status).toBe(403);
    });

    it("returns 403 for client", async () => {
      const clientToken = makeClientToken();
      const res = await request(app).post("/api/auth/register")
        .set(authHeaders(clientToken))
        .send({ email: "x@test.com", password: "password123", name: "X" });
      expect(res.status).toBe(403);
    });

    it("returns 409 for duplicate email", async () => {
      const passwordHash = await bcrypt.hash("password123", 10);
      await mockRepos.userRepository.create({
        organizationId: "test-org", email: "dup@test.com", passwordHash,
        name: "Existing", role: "admin" as any, isActive: true
      });
      const res = await request(app).post("/api/auth/register")
        .set(authHeaders(adminToken))
        .send({ email: "dup@test.com", password: "password456", name: "Dup" });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns user info", async () => {
      const passwordHash = await bcrypt.hash("password123", 10);
      const user = await mockRepos.userRepository.create({
        organizationId: "test-org", email: "admin@test.com", passwordHash,
        name: "Admin User", role: "admin" as any, isActive: true
      });
      const token = jwt.sign(
        { sub: user.id, email: user.email, role: user.role, organizationId: user.organizationId },
        JWT_SECRET, { expiresIn: 3600 }
      );
      const res = await request(app).get("/api/auth/me").set(authHeaders(token));
      expect(res.status).toBe(200);
      expect(res.body.email).toBe("admin@test.com");
      expect(res.body).not.toHaveProperty("passwordHash");
    });

    it("returns 403 without token", async () => {
      const res = await request(app).get("/api/auth/me");
      expect(res.status).toBe(403);
    });
  });

  describe("Authentication gate", () => {
    it("returns 403 for /api routes without JWT", async () => {
      for (const path of ["/api/health", "/api/clients", "/api/plans", "/api/cron/config"]) {
        const res = await request(app).get(path);
        expect(res.status).toBe(403);
      }
    });
  });
});

describe("Integration: client routes", () => {
  const adminToken = makeAdminToken();
  const clientToken = makeClientToken();

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("GET /api/clients", () => {
    it("returns paginated list", async () => {
      await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Alice", phone: "+584141", dni: "D-001", address: "A1" });
      await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Bob", phone: "+584142", dni: "D-002", address: "A2" });
      await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Carol", phone: "+584143", dni: "D-003", address: "A3" });
      const res = await request(app).get("/api/clients").set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.total).toBe(3);
    });

    it("paginates with page/limit", async () => {
      for (let i = 1; i <= 5; i++) {
        await mockRepos.clientRepository.create({ organizationId: "test-org", name: `C${i}`, phone: `+584140${i}`, dni: `D-${i}`, address: `A${i}` });
      }
      const res = await request(app).get("/api/clients?page=2&limit=2").set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.page).toBe(2);
      expect(res.body.total).toBe(5);
      expect(res.body.totalPages).toBe(3);
    });

    it("returns 403 for client", async () => {
      const res = await request(app).get("/api/clients").set(authHeaders(clientToken));
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/clients", () => {
    it("creates a client", async () => {
      const res = await request(app).post("/api/clients").set(authHeaders(adminToken))
        .send({ name: "New", dni: "12345678", phone: "+584149999", address: "Main" });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe("New");
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app).post("/api/clients").set(authHeaders(adminToken)).send({ address: "Only" });
      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate phone", async () => {
      await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Existing", phone: "+584140001111", dni: "D-EXIST", address: "A" });
      const res = await request(app).post("/api/clients").set(authHeaders(adminToken))
        .send({ name: "Dup", dni: "D-DUP", phone: "+584140001111", address: "B" });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/clients/:clientId", () => {
    it("returns client with subscriptions", async () => {
      const client = await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Target", phone: "+584142222", dni: "D-TARGET", address: "A" });
      await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "SUB-001", starlinkAccountId: "acc", kitId: "kit",
        planId: "plan", planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "Target", currentOwnerDni: "123"
      });
      const res = await request(app).get(`/api/clients/${client.id}`).set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Target");
      expect(res.body.subscriptions).toHaveLength(1);
    });
  });

  describe("DELETE /api/clients/:clientId", () => {
    it("returns 204 after delete", async () => {
      const client = await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Del", phone: "+584145555", dni: "D-DEL", address: "A" });
      const res = await request(app).delete(`/api/clients/${client.id}`).set(authHeaders(adminToken));
      expect(res.status).toBe(204);
    });
  });
});

describe("Integration: plan routes", () => {
  const adminToken = makeAdminToken();

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("GET /api/plans", () => {
    it("returns paginated active plans", async () => {
      await mockRepos.planRepository.create({ organizationId: "test-org", name: "Basic", code: "BASIC", priceUsd: 30, lateFeeUsd: 10, graceDays: 30, isActive: true });
      await mockRepos.planRepository.create({ organizationId: "test-org", name: "Legacy", code: "LEGACY", priceUsd: 20, lateFeeUsd: 5, graceDays: 15, isActive: false });
      const res = await request(app).get("/api/plans").set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it("includes inactive with includeInactive", async () => {
      await mockRepos.planRepository.create({ organizationId: "test-org", name: "Act", code: "ACT", priceUsd: 40, lateFeeUsd: 10, graceDays: 30, isActive: true });
      await mockRepos.planRepository.create({ organizationId: "test-org", name: "Inact", code: "INACT", priceUsd: 20, lateFeeUsd: 5, graceDays: 15, isActive: false });
      const res = await request(app).get("/api/plans?includeInactive=true").set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it("paginates correctly", async () => {
      for (let i = 1; i <= 6; i++) {
        await mockRepos.planRepository.create({ organizationId: "test-org", name: `P${i}`, code: `P${i}`, priceUsd: i * 10, lateFeeUsd: 10, graceDays: 30, isActive: true });
      }
      const res = await request(app).get("/api/plans?page=2&limit=3").set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.total).toBe(6);
      expect(res.body.totalPages).toBe(2);
    });
  });

  describe("POST /api/plans", () => {
    it("creates a plan", async () => {
      const res = await request(app).post("/api/plans").set(authHeaders(adminToken))
        .send({ name: "Premium", code: "PREMIUM", priceUsd: 80, lateFeeUsd: 20, graceDays: 30 });
      expect(res.status).toBe(201);
      expect(res.body.code).toBe("PREMIUM");
    });

    it("returns 400 for invalid code format", async () => {
      const res = await request(app).post("/api/plans").set(authHeaders(adminToken))
        .send({ name: "X", code: "invalid-lower", priceUsd: 50 });
      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate code", async () => {
      await mockRepos.planRepository.create({ organizationId: "test-org", name: "X", code: "DUP", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true });
      const res = await request(app).post("/api/plans").set(authHeaders(adminToken))
        .send({ name: "Y", code: "DUP", priceUsd: 60 });
      expect(res.status).toBe(409);
    });
  });
});

describe("Integration: subscription routes", () => {
  const adminToken = makeAdminToken();

  const seed = async () => {
    const client = await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Client", phone: "+584140000001", dni: "V-123", address: "Addr" });
    const plan = await mockRepos.planRepository.create({ organizationId: "test-org", name: "Basic", code: "BASIC", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true });
    return { client, plan };
  };

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("POST /api/subscriptions", () => {
    it("creates subscription with billing period", async () => {
      const { client, plan } = await seed();
      const res = await request(app).post("/api/subscriptions").set(authHeaders(adminToken))
        .send({ clientId: client.id, code: "STAR-001", starlinkAccountId: "ACC", kitId: "KIT", planId: plan.id, dueDay: 15 });
      expect(res.status).toBe(201);
      expect(res.body.subscriptionId).toBeDefined();
      expect(res.body.status).toBe("paused");
      expect(res.body.initialBillingPeriodId).toBeDefined();
    });

    it("returns 409 for duplicate code", async () => {
      const { client, plan } = await seed();
      await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "DUP", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "paused" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "C", currentOwnerDni: "1"
      });
      const res = await request(app).post("/api/subscriptions").set(authHeaders(adminToken))
        .send({ clientId: client.id, code: "DUP", starlinkAccountId: "a2", kitId: "k2", planId: plan.id, dueDay: 15 });
      expect(res.status).toBe(409);
    });

    it("returns 403 without JWT", async () => {
      const res = await request(app).post("/api/subscriptions")
        .send({ clientId: "x", code: "x", starlinkAccountId: "x", kitId: "x", planId: "x", dueDay: 15 });
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/subscriptions/:id/suspend", () => {
    it("suspends active subscription", async () => {
      const { client, plan } = await seed();
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "SUSP", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "C", currentOwnerDni: "1"
      });
      await mockRepos.billingPeriodRepository.create({
        organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
        type: "regular" as any, startDate: "2026-01-01", dueDate: "2026-02-01",
        status: "paid" as any, amountUsd: 50, paidAmountUsd: 50, surchargeUsd: 0
      });
      const res = await request(app).post(`/api/subscriptions/${sub.id}/suspend`)
        .set(authHeaders(adminToken)).send({ reason: "Test" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("suspended");
    });

    it("returns 409 if already suspended", async () => {
      const { client, plan } = await seed();
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "ALREADY", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "suspended" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "C", currentOwnerDni: "1"
      });
      const res = await request(app).post(`/api/subscriptions/${sub.id}/suspend`)
        .set(authHeaders(adminToken)).send({ reason: "Test" });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/subscriptions/:id", () => {
    it("returns enriched response with client, activePeriod, debt, calculated", async () => {
      const { client, plan } = await seed();
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "ENRICH-001", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: client.name, currentOwnerDni: client.dni
      });
      await mockRepos.billingPeriodRepository.create({
        organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
        type: "regular" as any, startDate: "2026-06-15", dueDate: "2026-07-15",
        status: "pending" as any, amountUsd: 50, paidAmountUsd: 0, surchargeUsd: 0
      });

      const res = await request(app).get(`/api/subscriptions/${sub.id}`).set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.subscription).toBeDefined();
      expect(res.body.subscription.code).toBe("ENRICH-001");
      expect(res.body.client).toBeDefined();
      expect(res.body.client.name).toBe("Client");
      expect(res.body.client.dni).toBe("V-123");
      expect(res.body.client.phone).toBe("+584140000001");
      expect(res.body.client.address).toBe("Addr");
      expect(res.body.activePeriod).toBeDefined();
      expect(res.body.activePeriod.balanceUsd).toBe(50);
      expect(res.body.activePeriod.status).toBe("pending");
      expect(res.body.debt).toBeDefined();
      expect(res.body.debt.totalDueUsd).toBeDefined();
      expect(res.body.periods).toHaveLength(1);
      expect(res.body.calculated).toBeDefined();
      expect(res.body.calculated.status).toBe("active");
      expect(res.body.calculated.isOverdue).toBe(false);
      expect(res.body.calculated.isSuspended).toBe(false);
    });

    it("detects overdue status correctly", async () => {
      const { client, plan } = await seed();
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "ENRICH-002", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 5, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: client.name, currentOwnerDni: client.dni
      });
      await mockRepos.billingPeriodRepository.create({
        organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
        type: "regular" as any, startDate: "2026-01-01", dueDate: "2026-01-05",
        status: "pending" as any, amountUsd: 50, paidAmountUsd: 0, surchargeUsd: 0
      });

      const res = await request(app).get(`/api/subscriptions/${sub.id}`).set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.calculated.isOverdue).toBe(true);
      expect(res.body.calculated.status).toBe("overdue");
    });

    it("returns activePeriod as null when no pending periods", async () => {
      const { client, plan } = await seed();
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", code: "ENRICH-003", starlinkAccountId: "a", kitId: "k",
        planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: client.name, currentOwnerDni: client.dni
      });
      await mockRepos.billingPeriodRepository.create({
        organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
        type: "regular" as any, startDate: "2026-01-01", dueDate: "2026-02-15",
        status: "paid" as any, amountUsd: 50, paidAmountUsd: 50, surchargeUsd: 0
      });

      const res = await request(app).get(`/api/subscriptions/${sub.id}`).set(authHeaders(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.activePeriod).toBeNull();
    });

    it("returns 404 for nonexistent subscription", async () => {
      const res = await request(app).get("/api/subscriptions/nonexistent-id").set(authHeaders(adminToken));
      expect(res.status).toBe(404);
    });
  });
});

describe("Integration: payment routes", () => {
  const adminToken = makeAdminToken();

  const seed = async () => {
    const client = await mockRepos.clientRepository.create({ organizationId: "test-org", name: "Client", phone: "+584141", dni: "D-C", address: "A" });
    const plan = await mockRepos.planRepository.create({ organizationId: "test-org", name: "Basic", code: "PAY", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true });
    const sub = await mockRepos.subscriptionRepository.create({
      organizationId: "test-org", code: "PAY-SUB", starlinkAccountId: "a", kitId: "k",
      planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
      status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
      currentOwnerName: "C", currentOwnerDni: "1"
    });
    const period = await mockRepos.billingPeriodRepository.create({
      organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
      type: "regular" as any, startDate: "2026-01-01", dueDate: "2026-02-01",
      status: "pending" as any, amountUsd: 50, paidAmountUsd: 0, surchargeUsd: 0
    });
    return { client, plan, sub, period };
  };

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("POST /api/subscriptions/:id/payments", () => {
    it("registers a payment", async () => {
      const { sub, period } = await seed();
      const res = await request(app).post(`/api/subscriptions/${sub.id}/payments`)
        .set(authHeaders(adminToken))
        .send({ 
          billingPeriodId: period.id, 
          amount: 50, 
          currency: "USD", 
          exchangeRate: 1, 
          reference: "REF-001", 
          proofImage: "https://example.com/proof.jpg",
          paidAt: "2026-01-15T12:00:00Z" 
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe("registered");
    });

    it("returns 400 when exchangeRate is missing", async () => {
      const { sub, period } = await seed();
      const res = await request(app).post(`/api/subscriptions/${sub.id}/payments`)
        .set(authHeaders(adminToken))
        .send({ 
          billingPeriodId: period.id, 
          amount: 50, 
          currency: "USD", 
          reference: "REF-002", 
          proofImage: "https://example.com/proof.jpg",
          paidAt: "2026-01-15T12:00:00Z" 
        });
      expect(res.status).toBe(400);
    });

    it("returns 400 when proofImage is missing", async () => {
      const { sub, period } = await seed();
      const res = await request(app).post(`/api/subscriptions/${sub.id}/payments`)
        .set(authHeaders(adminToken))
        .send({ 
          billingPeriodId: period.id, 
          amount: 50, 
          currency: "USD", 
          exchangeRate: 1,
          reference: "REF-003", 
          paidAt: "2026-01-15T12:00:00Z" 
        });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/payments/:id/confirm", () => {
    it("confirms payment and updates billing period", async () => {
      const { client, sub, period } = await seed();
      const payment = await mockRepos.paymentRepository.create({
        organizationId: "test-org", billingPeriodId: period.id, subscriptionId: sub.id,
        clientId: client.id, amount: 50, currency: "USD" as any, exchangeRate: 1,
        amountUsd: 50, reference: "CONF", paidAt: "2026-01-15T12:00:00Z",
        createdBy: "admin-1", status: "registered" as any
      });
      const res = await request(app).post(`/api/payments/${payment.id}/confirm`)
        .set(authHeaders(adminToken)).send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("confirmed");
    });
  });

  describe("POST /api/payments/:id/void", () => {
    it("voids a payment", async () => {
      const { client, sub, period } = await seed();
      const payment = await mockRepos.paymentRepository.create({
        organizationId: "test-org", billingPeriodId: period.id, subscriptionId: sub.id,
        clientId: client.id, amount: 50, currency: "USD" as any, exchangeRate: 1,
        amountUsd: 50, reference: "VOID", paidAt: "2026-01-15T12:00:00Z",
        createdBy: "admin-1", status: "registered" as any
      });
      const res = await request(app).post(`/api/payments/${payment.id}/void`)
        .set(authHeaders(adminToken)).send({ reason: "Test" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("voided");
    });

    it("returns 400 without reason", async () => {
      const { client, sub, period } = await seed();
      const payment = await mockRepos.paymentRepository.create({
        organizationId: "test-org", billingPeriodId: period.id, subscriptionId: sub.id,
        clientId: client.id, amount: 50, currency: "USD" as any, exchangeRate: 1,
        amountUsd: 50, reference: "VOID2", paidAt: "2026-01-15T12:00:00Z",
        createdBy: "admin-1", status: "registered" as any
      });
      const res = await request(app).post(`/api/payments/${payment.id}/void`)
        .set(authHeaders(adminToken)).send({});
      expect(res.status).toBe(400);
    });
  });
});

describe("Integration: client portal routes", () => {
  const seedPortal = async () => {
    const client = await mockRepos.clientRepository.create({
      organizationId: "test-org", name: "Portal Client", phone: "+58414777", dni: "D-PORTAL", address: "Portal St"
    });
    const plan = await mockRepos.planRepository.create({
      organizationId: "test-org", name: "Basic", code: "PORTAL", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true
    });
    const sub = await mockRepos.subscriptionRepository.create({
      organizationId: "test-org", code: "PORTAL-SUB", starlinkAccountId: "a", kitId: "k",
      planId: plan.id, planName: "Basic", clientId: client.id, priceUsd: 50,
      status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
      currentOwnerName: client.name, currentOwnerDni: client.dni
    });
    await mockRepos.billingPeriodRepository.create({
      organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
      type: "regular" as any, startDate: "2026-06-15", dueDate: "2026-07-15",
      status: "pending" as any, amountUsd: 50, paidAmountUsd: 0, surchargeUsd: 0
    });
    const clientToken = makeClientToken("test-org", "user-client-1", client.id);
    return { client, plan, sub, clientToken };
  };

  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("GET /api/client/profile", () => {
    it("returns client profile for authenticated client user", async () => {
      const { client, clientToken } = await seedPortal();
      const res = await request(app).get("/api/client/profile").set(authHeaders(clientToken));
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(client.id);
      expect(res.body.name).toBe("Portal Client");
      expect(res.body.dni).toBe("D-PORTAL");
    });

    it("returns 403 for admin user", async () => {
      const adminToken = makeAdminToken();
      const res = await request(app).get("/api/client/profile").set(authHeaders(adminToken));
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/client/subscription", () => {
    it("returns enriched subscription for client", async () => {
      const { client, sub, clientToken } = await seedPortal();
      const res = await request(app).get("/api/client/subscription").set(authHeaders(clientToken));
      expect(res.status).toBe(200);
      expect(res.body.subscription).toBeDefined();
      expect(res.body.client).toBeDefined();
      expect(res.body.client.id).toBe(client.id);
      expect(res.body.activePeriod).toBeDefined();
      expect(res.body.calculated).toBeDefined();
    });

    it("returns null subscription when client has no subscriptions", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "No Sub", phone: "+58414888", dni: "D-NOSUB", address: "Empty"
      });
      const clientToken = makeClientToken("test-org", "user-nosub", client.id);
      const res = await request(app).get("/api/client/subscription").set(authHeaders(clientToken));
      expect(res.status).toBe(200);
      expect(res.body.subscription).toBeNull();
    });
  });

  describe("GET /api/client/payments", () => {
    it("returns empty payments list", async () => {
      const { clientToken } = await seedPortal();
      const res = await request(app).get("/api/client/payments").set(authHeaders(clientToken));
      expect(res.status).toBe(200);
      expect(res.body.payments).toEqual([]);
    });
  });

  describe("GET /api/client/debt", () => {
    it("returns debt summary for client", async () => {
      const { sub, clientToken } = await seedPortal();
      const res = await request(app).get("/api/client/debt").set(authHeaders(clientToken));
      expect(res.status).toBe(200);
      expect(res.body.totalDueUsd).toBeDefined();
    });
  });
});
