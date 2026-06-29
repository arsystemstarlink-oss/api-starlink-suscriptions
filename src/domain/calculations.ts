export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateDailyRate(priceUsd: number): number {
  return roundMoney(priceUsd / 30);
}

export function calculateAdvanceCharge(priceUsd: number, daysUntilCutoff: number): {
  days: number;
  amountUsd: number;
  surchargeUsd: number;
  totalUsd: number;
} {
  const safeDays = Math.max(0, daysUntilCutoff);
  const amountUsd = roundMoney(calculateDailyRate(priceUsd) * safeDays);
  const surchargeUsd = roundMoney(amountUsd * 0.05);
  const totalUsd = roundMoney(amountUsd + surchargeUsd);

  return {
    days: safeDays,
    amountUsd,
    surchargeUsd,
    totalUsd
  };
}

export function calculateReactivationTotal(input: {
  overdueAmountUsd: number;
  lateFeeUsd: number;
  advanceAmountUsd: number;
  surchargeUsd: number;
}): number {
  return roundMoney(
    input.overdueAmountUsd + input.lateFeeUsd + input.advanceAmountUsd + input.surchargeUsd
  );
}
