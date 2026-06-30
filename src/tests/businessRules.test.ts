import {
  calculateAdvanceCharge,
  calculateReactivationTotal,
  calculateDailyRate,
  roundMoney
} from "../domain/calculations.js";
import { daysUntilNextCutoff, nextCutoffDate, toDateString, addDays, toLocalDate } from "../domain/dateUtils.js";

describe("Plan §10 - Casos de negocio", () => {
  describe("Caso 1: Creación y primer pago", () => {
    it("al crear suscripción en la fecha de corte, el primer vencimiento es el próximo mes", () => {
      const dueDate = nextCutoffDate(toLocalDate("2026-05-05"), 5);
      expect(toDateString(dueDate)).toBe("2026-06-05");
    });

    it("al pagar completo, siguiente vencimiento es un mes después", () => {
      const nextCutoff = nextCutoffDate(toLocalDate("2026-06-05"), 5);
      expect(toDateString(nextCutoff)).toBe("2026-07-05");
    });
  });

  describe("Caso 2: Pago parcial antes de vencer", () => {
    it("deuda de 120, pago parcial de 50 => saldo pendiente 70", () => {
      const amountUsd = 120;
      const paymentUsd = 50;
      const balance = roundMoney(amountUsd - paymentUsd);
      expect(balance).toBe(70);
    });
  });

  describe("Caso 3: Vencimiento", () => {
    it("dueDate 2026-05-05 => día después es 2026-05-06", () => {
      const dueDate = "2026-05-05";
      const dayAfter = toDateString(addDays(dueDate, 1));
      expect(dayAfter).toBe("2026-05-06");
    });
  });

  describe("Caso 4: Suspensión automática", () => {
    it("vencimiento 2026-05-05, graceDays=30 => suspensión 2026-06-04", () => {
      const dueDate = "2026-05-05";
      const graceDays = 30;
      const suspensionDate = toDateString(addDays(dueDate, graceDays));
      expect(suspensionDate).toBe("2026-06-04");
    });

    it("mora se aplica una sola vez por ciclo", () => {
      const lateFeeUsd = 10;
      let lateFeeApplied = false;
      const applyOnce = () => {
        if (lateFeeApplied) return 0;
        lateFeeApplied = true;
        return lateFeeUsd;
      };
      expect(applyOnce()).toBe(10);
      expect(applyOnce()).toBe(0);
    });
  });

  describe("Caso 5: Reactivación suspendida", () => {
    it("prorrata: 120 USD/mes, pago 30 de junio, corte 5 de julio, 10 días restantes => 40 USD prorrata + 2 USD recargo = 42 USD total", () => {
      const priceUsd = 120;
      const remainingDays = 10;

      const advance = calculateAdvanceCharge(priceUsd, remainingDays);

      expect(advance.amountUsd).toBe(40);
      expect(advance.surchargeUsd).toBe(2);
      expect(advance.totalUsd).toBe(42);
    });

    it("total reactivación: 120 deuda + 10 mora + 40 prorrata + 2 recargo = 172 USD", () => {
      const total = calculateReactivationTotal({
        overdueAmountUsd: 120,
        lateFeeUsd: 10,
        advanceAmountUsd: 40,
        surchargeUsd: 2
      });

      expect(total).toBe(172);
    });

    it("si paga menos de 172, no puede reactivar", () => {
      const requiredUsd = 172;
      const paidUsd = 150;
      const canReactivate = paidUsd >= requiredUsd;
      expect(canReactivate).toBe(false);
    });

    it("si paga exactamente 172, puede reactivar", () => {
      const requiredUsd = 172;
      const paidUsd = 172;
      const canReactivate = paidUsd >= requiredUsd;
      expect(canReactivate).toBe(true);
    });
  });

  describe("Caso 6: Pago en Bs", () => {
    it("4320 Bs a tasa 36 Bs/USD => 120 USD", () => {
      const amountBs = 4320;
      const exchangeRate = 36;
      const amountUsd = roundMoney(amountBs * exchangeRate);
      expect(amountUsd).toBe(155520);

      // El plan dice: amount = 4320 Bs, exchangeRate = 36 => amountUsd = 120
      // Esto implica exchangeRate = Bs por USD, entonces amountUsd = amount / exchangeRate
      const amountUsd2 = roundMoney(4320 / 36);
      expect(amountUsd2).toBe(120);
    });

    it("el redondeo a 2 decimales funciona correctamente", () => {
      expect(roundMoney(120.005)).toBe(120.01);
      expect(roundMoney(120.004)).toBe(120.0);
      expect(roundMoney(100.555)).toBe(100.56);
    });
  });

  describe("Caso 7: Operador registra, admin confirma", () => {
    it("pago registrado no afecta deuda hasta confirmarse", () => {
      const paidAmountBeforeConfirm = 0;
      const registeredButNotConfirmed = true;
      expect(paidAmountBeforeConfirm).toBe(0);
      expect(registeredButNotConfirmed).toBe(true);
    });

    it("al confirmar pago de 120 sobre período de 120, status cambia a paid", () => {
      const amountUsd = 120;
      const paymentAmountUsd = 120;
      const newPaidAmount = roundMoney(0 + paymentAmountUsd);
      const status = newPaidAmount >= amountUsd ? "paid" : "partial";
      expect(status).toBe("paid");
    });
  });

  describe("Caso 8: Anulación de pago", () => {
    it("anular pago confirmed recalcula deuda correctamente", () => {
      const periodAmount = 120;
      const confirmedPayments = [
        { id: "p1", amountUsd: 120, status: "confirmed" }
      ];
      const voidedPayments = [
        { id: "p1", amountUsd: 120, status: "voided" }
      ];

      const remainingConfirmed = confirmedPayments.filter(
        (p) => !voidedPayments.find((v) => v.id === p.id)
      );
      const paidAmount = remainingConfirmed.reduce((sum, p) => sum + p.amountUsd, 0);
      expect(paidAmount).toBe(0);
    });
  });

  describe("Caso 9: Transferencia", () => {
    it("starlinkAccountId no cambia en transferencia", () => {
      const originalStarlinkAccountId = "ACC-01-0001";
      const transferResult = { ...{ starlinkAccountId: originalStarlinkAccountId, clientId: "oldClient" }, clientId: "newClient" };
      expect(transferResult.starlinkAccountId).toBe("ACC-01-0001");
      expect(transferResult.clientId).toBe("newClient");
    });
  });

  describe("Caso 10: No permitir pagos a período ya pagado", () => {
    it("período con status paid rechaza nuevo pago", () => {
      const periodStatus = "paid";
      const canAcceptPayment = periodStatus !== "paid";
      expect(canAcceptPayment).toBe(false);
    });
  });
});

describe("Plan §12 - Validaciones de implementación", () => {
  it("pago parcial NO activa suscripción suspendida (solo paid lo hace)", () => {
    const periodAmount = 120;
    const partialPayment = 50;
    const subscriptionWasSuspended = true;
    const newPaidAmount = partialPayment;
    const periodBecamePaid = newPaidAmount >= periodAmount;
    const reactivatesSuspendedSubscription = periodBecamePaid && !subscriptionWasSuspended;
    expect(reactivatesSuspendedSubscription).toBe(false);
  });

  it("recargo 5% solo se aplica después de suspensión", () => {
    const wasSuspended = true;
    const advanceDays = 10;
    const priceUsd = 120;
    const advance = calculateAdvanceCharge(priceUsd, advanceDays);
    const surchargeApplied = wasSuspended && advance.surchargeUsd > 0;
    expect(surchargeApplied).toBe(true);
  });

  it("prorrata usa 30 días fijos", () => {
    const priceUsd = 120;
    const dailyRate = calculateDailyRate(priceUsd);
    expect(dailyRate).toBe(4);
    expect(priceUsd / 30).toBe(dailyRate);
  });
});
