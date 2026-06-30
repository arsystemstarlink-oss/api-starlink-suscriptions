import { jest } from "@jest/globals";
import * as mockRepos from "./helpers/mockRepositories.js";
import * as mockNotifService from "./helpers/mockNotificationService.js";
import * as mockCommService from "./helpers/mockCommunicationService.js";

jest.unstable_mockModule("../infrastructure/firestore/repositories.js", () => mockRepos);
jest.unstable_mockModule("../config/firebase.js", () => ({ ensureFirebaseInitialized: () => {} }));
jest.unstable_mockModule("../infrastructure/websocket/websocketServer.js", () => ({ webSocketServer: { initialize: () => {}, shutdown: () => {}, broadcastCommunication: () => {}, broadcastCommunicationSent: () => {}, broadcastCommunicationReceived: () => {}, broadcastCommunicationFailed: () => {} } }));
jest.unstable_mockModule("../services/cron/schedulerService.js", () => ({ schedulerService: { initialize: async () => {}, shutdown: () => {}, getStatus: () => ({ isRunning: false }), updateConfig: async (d: any) => d, getConfig: async () => null } }));
jest.unstable_mockModule("../services/notifications/notificationService.js", () => mockNotifService);
jest.unstable_mockModule("../services/communications/communicationService.js", () => mockCommService);

process.env.ORGANIZATION_ID = "test-org";
process.env.NODE_ENV = "test";
process.env.TWILIO_AUTH_TOKEN = "test-token-not-empty-so-validation-works-ok-ok";
process.env.TWILIO_WEBHOOK_URL = "https://test.example.com";

const { subscriptionService } = await import("../services/subscriptions/subscriptionService.js");
const { paymentService } = await import("../services/payments/paymentService.js");
const { billingService } = await import("../services/billing/billingService.js");
const { previousCutoffDate, nextCutoffDate, addDays, toDateString, toLocalDate } = await import("../domain/dateUtils.js");
const { UserRole, PaymentCurrency } = await import("../domain/types.js");

const ctx = { organizationId: "test-org", userId: "admin-1", role: UserRole.Admin };

describe("Auditoría de lógica de facturación", () => {
  beforeEach(() => {
    mockRepos.store.reset();
  });

  describe("previousCutoffDate", () => {
    it("retorna el último corte anterior cuando today > dueDay", () => {
      const result = previousCutoffDate(toLocalDate("2026-06-30"), 21);
      expect(toDateString(result)).toBe("2026-06-21");
    });

    it("retorna el corte del mes anterior cuando today < dueDay", () => {
      const result = previousCutoffDate(toLocalDate("2026-06-15"), 21);
      expect(toDateString(result)).toBe("2026-05-21");
    });

    it("retorna el corte actual cuando today = dueDay", () => {
      const result = previousCutoffDate(toLocalDate("2026-06-21"), 21);
      expect(toDateString(result)).toBe("2026-06-21");
    });
  });

  describe("Fechas correctas del billing period inicial", () => {
    it("genera billing period con startDate = día de corte anterior y dueDate = día antes del próximo corte", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Audit Client", phone: "+58999",
        dni: "D-AUDIT", address: "Addr", email: "audit@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Audit Plan", priceUsd: 30, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const result = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "AUDIT-001",
        kitId: "kit-audit",
        planId: plan.id,
        dueDay: 21,
        starlinkPassword: "pass"
      });

      const period = result.billingPeriod;

      const startDate = new Date();
      startDate.setDate(21);
      startDate.setMonth(startDate.getMonth() - (startDate.getDate() < 21 ? 1 : 0));

      const now = new Date();
      const nextCutoff = nextCutoffDate(now, 21);
      const expectedDueDate = addDays(nextCutoff, -1);

      expect(toDateString(period.startDate)).toBe(toDateString(previousCutoffDate(now, 21)));
      expect(toDateString(period.dueDate)).toBe(toDateString(expectedDueDate));
      expect(period.status).toBe("pending");
      expect(period.amountUsd).toBe(30);
    });

    it("no genera períodos anteriores al inicio del servicio", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Late Reg Client", phone: "+58888",
        dni: "D-LATE", address: "Addr", email: "late@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Late Plan", priceUsd: 30, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const result = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "LATE-001",
        kitId: "kit-late",
        planId: plan.id,
        dueDay: 21,
        starlinkPassword: "pass"
      });

      const periods = await mockRepos.billingPeriodRepository.getBySubscription("test-org", result.subscription.id);
      expect(periods.length).toBe(1);
    });
  });

  describe("Confirmar pago no genera billing period extra", () => {
    it("después de confirmar el primer pago solo existe un billing period", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Pay Client", phone: "+58777",
        dni: "D-PAY", address: "Addr", email: "pay@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Pay Plan", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const subResult = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "PAY-001",
        kitId: "kit-pay",
        planId: plan.id,
        dueDay: 15,
        starlinkPassword: "pass"
      });

      const period = subResult.billingPeriod;

      const registeredPayment = await paymentService.register({
        context: ctx,
        billingPeriodId: period.id,
        amount: 50,
        currency: PaymentCurrency.USD,        exchangeRate: 1,
        reference: "PAY-REF-001",
        paidAt: "2026-01-15T12:00:00Z"
      });

      await paymentService.confirm(ctx, registeredPayment.id);

      const periodsAfterConfirm = await mockRepos.billingPeriodRepository.getBySubscription("test-org", subResult.subscription.id);

      expect(periodsAfterConfirm.length).toBe(1);
      expect(periodsAfterConfirm[0].status).toBe("paid");
    });

    it("la suscripción queda Active después de confirmar el primer pago", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Active Client", phone: "+58666",
        dni: "D-ACT", address: "Addr", email: "active@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Active Plan", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const subResult = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "ACTIVE-001",
        kitId: "kit-active",
        planId: plan.id,
        dueDay: 15,
        starlinkPassword: "pass"
      });

      const period = subResult.billingPeriod;

      const payment = await paymentService.register({
        context: ctx,
        billingPeriodId: period.id,
        amount: 50,
        currency: PaymentCurrency.USD,        exchangeRate: 1,
        reference: "ACTIVE-REF-001",
        paidAt: "2026-01-15T12:00:00Z"
      });

      await paymentService.confirm(ctx, payment.id);

      const subscription = await mockRepos.subscriptionRepository.getById("test-org", subResult.subscription.id);
      expect(subscription!.status).toBe("active");
    });
  });

  describe("calculateDebt — períodos vigentes no son deuda", () => {
    it("período Pending con dueDate futuro no aparece como deuda", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Debt Client", phone: "+58555",
        dni: "D-DEBT", address: "Addr", email: "debt@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Debt Plan", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const subResult = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "DEBT-001",
        kitId: "kit-debt",
        planId: plan.id,
        dueDay: 15,
        starlinkPassword: "pass"
      });

      const debt = await paymentService.calculateDebt(ctx, subResult.subscription.id);

      expect(debt.totalDueUsd).toBe(0);
      expect(debt.overduePeriods.length).toBe(0);
    });

    it("período Pending con dueDate pasado sí aparece como deuda", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Overdue Client", phone: "+58444",
        dni: "D-OVER", address: "Addr", email: "overdue@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Overdue Plan", priceUsd: 50, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", starlinkAccountId: "OVER-001", kitId: "k",
        planId: plan.id, planName: "Overdue Plan", clientId: client.id, priceUsd: 50,
        status: "active" as any, dueDay: 15, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "C", currentOwnerDni: "1",
        starlinkEmail: "over@starlink.com", starlinkPassword: "pass"
      });

      const pastDue = toDateString(addDays(new Date(), -30));
      await mockRepos.billingPeriodRepository.create({
        organizationId: "test-org", subscriptionId: sub.id, clientId: client.id,
        type: "regular" as any, startDate: "2026-05-01",
        dueDate: toDateString(addDays(new Date(), -1)),
        status: "pending" as any, amountUsd: 50, paidAmountUsd: 0, surchargeUsd: 0
      });

      const debt = await paymentService.calculateDebt(ctx, sub.id);

      expect(debt.totalDueUsd).toBeGreaterThan(0);
      expect(debt.overduePeriods.length).toBe(1);
      expect(debt.overduePeriods[0].balanceUsd).toBe(50);
    });
  });

  describe("Flujo completo: crear + pagar + sin deuda extra", () => {
    it("crear suscripción → registrar pago → confirmar → deuda = 0", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Full Flow Client", phone: "+58333",
        dni: "D-FULL", address: "Addr", email: "full@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Full Plan", priceUsd: 30, lateFeeUsd: 10, graceDays: 30, isActive: true
      });

      const subResult = await subscriptionService.create({
        context: ctx,
        clientId: client.id,
        starlinkAccountId: "FULL-001",
        kitId: "kit-full",
        planId: plan.id,
        dueDay: 21,
        starlinkPassword: "pass"
      });

      const period = subResult.billingPeriod;

      const payment = await paymentService.register({
        context: ctx,
        billingPeriodId: period.id,
        amount: 30,
        currency: PaymentCurrency.USD,        exchangeRate: 1,
        reference: "FULL-REF-001"
      });

      await paymentService.confirm(ctx, payment.id);

      const debt = await paymentService.calculateDebt(ctx, subResult.subscription.id);
      expect(debt.totalDueUsd).toBe(0);

      const periods = await mockRepos.billingPeriodRepository.getBySubscription("test-org", subResult.subscription.id);
      expect(periods.length).toBe(1);
      expect(periods[0].status).toBe("paid");
    });
  });

  describe("createNextRegularPeriod fechas correctas", () => {
    it("genera el siguiente período con startDate = dueDate anterior + 1 y dueDate = +1 mes", async () => {
      const client = await mockRepos.clientRepository.create({
        organizationId: "test-org", name: "Next Client", phone: "+58222",
        dni: "D-NEXT", address: "Addr", email: "next@test.com"
      });
      const plan = await mockRepos.planRepository.create({
        organizationId: "test-org", name: "Next Plan", priceUsd: 30, lateFeeUsd: 10, graceDays: 30, isActive: true
      });
      const sub = await mockRepos.subscriptionRepository.create({
        organizationId: "test-org", starlinkAccountId: "NEXT-001", kitId: "k",
        planId: plan.id, planName: "Next Plan", clientId: client.id, priceUsd: 30,
        status: "active" as any, dueDay: 21, graceDays: 30, lateFeeUsd: 10,
        currentOwnerName: "C", currentOwnerDni: "1",
        starlinkEmail: "next@starlink.com", starlinkPassword: "pass"
      });

      const nextPeriod = await billingService.createNextRegularPeriod({
        context: ctx,
        subscription: sub,
        previousDueDate: "2026-07-20"
      });

      expect(nextPeriod.startDate).toBe("2026-07-21");
      expect(nextPeriod.dueDate).toBe("2026-08-20");
      expect(nextPeriod.status).toBe("pending");
      expect(nextPeriod.paidAmountUsd).toBe(0);
    });
  });
});
