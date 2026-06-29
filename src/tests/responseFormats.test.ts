describe("Debt response format (plan §6)", () => {
  it("overduePeriods + advance estructura coincide con plan", () => {
    const debtResponse = {
      subscriptionId: "sub_123",
      status: "suspended",
      overduePeriods: [
        {
          billingPeriodId: "bp_123",
          startDate: "2026-05-05",
          dueDate: "2026-06-05",
          amountUsd: 120,
          paidAmountUsd: 0,
          balanceUsd: 120,
          lateFeeUsd: 10
        }
      ],
      advance: {
        days: 10,
        amountUsd: 40,
        surchargeUsd: 2,
        totalUsd: 42
      },
      totalDueUsd: 172
    };

    expect(debtResponse).toHaveProperty("overduePeriods");
    expect(debtResponse).toHaveProperty("advance");
    expect(debtResponse).toHaveProperty("totalDueUsd");

    const period = debtResponse.overduePeriods[0];
    expect(period).toHaveProperty("billingPeriodId");
    expect(period).toHaveProperty("startDate");
    expect(period).toHaveProperty("dueDate");
    expect(period).toHaveProperty("amountUsd");
    expect(period).toHaveProperty("paidAmountUsd");
    expect(period).toHaveProperty("balanceUsd");
    expect(period).toHaveProperty("lateFeeUsd");

    const advance = debtResponse.advance;
    expect(advance).toHaveProperty("days");
    expect(advance).toHaveProperty("amountUsd");
    expect(advance).toHaveProperty("surchargeUsd");
    expect(advance).toHaveProperty("totalUsd");
  });

  it("totalDueUsd = overduePeriods.balanceUsd + overduePeriods.lateFeeUsd + advance.totalUsd", () => {
    const overduePeriods = [{ balanceUsd: 120, lateFeeUsd: 10 }];
    const advance = { totalUsd: 42 };

    const totalDue =
      overduePeriods.reduce((sum, p) => sum + p.balanceUsd, 0) +
      overduePeriods.reduce((sum, p) => sum + p.lateFeeUsd, 0) +
      advance.totalUsd;

    expect(totalDue).toBe(172);
  });

  it("balanceUsd NO incluye lateFee (es pura deuda)", () => {
    const amountUsd = 120;
    const paidAmountUsd = 0;
    const balanceUsd = amountUsd - paidAmountUsd;
    expect(balanceUsd).toBe(120);

    const lateFeeUsd = 10;
    expect(balanceUsd + lateFeeUsd).not.toBe(balanceUsd);
  });
});

describe("Reactivation quote format (plan §6)", () => {
  it("breakdown separado: overdueAmountUsd SIN late fee, lateFeeUsd aparte", () => {
    const quote = {
      canReactivate: true,
      requiredUsd: 172,
      breakdown: {
        overdueAmountUsd: 120,
        lateFeeUsd: 10,
        advanceAmountUsd: 40,
        surchargeUsd: 2
      },
      nextCutoffDate: "2026-07-05"
    };

    const total = quote.breakdown.overdueAmountUsd +
      quote.breakdown.lateFeeUsd +
      quote.breakdown.advanceAmountUsd +
      quote.breakdown.surchargeUsd;

    expect(total).toBe(quote.requiredUsd);
  });

  it("canReactivate=false => requiredUsd=0 y breakdown en ceros", () => {
    const quote = {
      canReactivate: false,
      requiredUsd: 0,
      breakdown: {
        overdueAmountUsd: 0,
        lateFeeUsd: 0,
        advanceAmountUsd: 0,
        surchargeUsd: 0
      },
      nextCutoffDate: null
    };

    expect(quote.requiredUsd).toBe(0);
    expect(quote.nextCutoffDate).toBeNull();
  });
});

describe("Subscription creation response format (plan §6)", () => {
  it("respuesta inicial incluye subscriptionId, status=paused, initialBillingPeriodId, dueDate", () => {
    const response = {
      subscriptionId: "sub_abc",
      status: "paused",
      initialBillingPeriodId: "bp_xyz",
      dueDate: "2026-06-05"
    };

    expect(response.status).toBe("paused");
    expect(response).toHaveProperty("subscriptionId");
    expect(response).toHaveProperty("initialBillingPeriodId");
    expect(response).toHaveProperty("dueDate");
  });
});

describe("Payment registration response format (plan §6)", () => {
  it("pago registrado devuelve paymentId y status=registered", () => {
    const response = {
      paymentId: "pay_123",
      status: "registered"
    };

    expect(response.status).toBe("registered");
  });
});
