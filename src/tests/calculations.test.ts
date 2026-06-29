import { roundMoney, calculateDailyRate, calculateAdvanceCharge, calculateReactivationTotal } from "../domain/calculations.js";

describe("calculations", () => {
  describe("roundMoney", () => {
    it("rounds to 2 decimals", () => {
      expect(roundMoney(1.005)).toBe(1.01);
      expect(roundMoney(1.004)).toBe(1.0);
      expect(roundMoney(120)).toBe(120);
    });
  });

  describe("calculateDailyRate", () => {
    it("divides monthly price by 30 days", () => {
      expect(calculateDailyRate(120)).toBe(4);
    });

    it("rounds result to 2 decimals", () => {
      expect(calculateDailyRate(100)).toBe(3.33);
    });
  });

  describe("calculateAdvanceCharge", () => {
    it("calculates prorrata for remaining days", () => {
      const result = calculateAdvanceCharge(120, 10);
      expect(result).toEqual({
        days: 10,
        amountUsd: 40,
        surchargeUsd: 2,
        totalUsd: 42
      });
    });

    it("handles 0 days remaining", () => {
      const result = calculateAdvanceCharge(120, 0);
      expect(result.totalUsd).toBe(0);
    });

    it("handles negative days as 0", () => {
      const result = calculateAdvanceCharge(120, -5);
      expect(result.days).toBe(0);
      expect(result.totalUsd).toBe(0);
    });

    it("matches plan example: 120/mo, 10 days remaining", () => {
      const result = calculateAdvanceCharge(120, 10);
      expect(result.amountUsd).toBe(40);
      expect(result.surchargeUsd).toBe(2);
      expect(result.totalUsd).toBe(42);
    });
  });

  describe("calculateReactivationTotal", () => {
    it("sums all components", () => {
      const total = calculateReactivationTotal({
        overdueAmountUsd: 120,
        lateFeeUsd: 10,
        advanceAmountUsd: 40,
        surchargeUsd: 2
      });
      expect(total).toBe(172);
    });

    it("handles zero values", () => {
      const total = calculateReactivationTotal({
        overdueAmountUsd: 0,
        lateFeeUsd: 0,
        advanceAmountUsd: 0,
        surchargeUsd: 0
      });
      expect(total).toBe(0);
    });
  });
});
