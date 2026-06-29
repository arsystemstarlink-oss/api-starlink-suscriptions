import { BusinessRuleError } from "./errors.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function toLocalDate(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00`) : value;

  if (Number.isNaN(date.getTime())) {
    throw new BusinessRuleError("Fecha inválida");
  }

  return date;
}

function toLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function toDateString(value: Date | string): string {
  const date = typeof value === "string" ? value : value;
  const d = toLocalDate(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addMonthsPreservingDay(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);

  const actualMonth = result.getMonth() % 12;
  if (actualMonth !== targetMonth % 12) {
    result.setDate(0);
  }

  return result;
}

export function nextCutoffDate(from: Date | string, dueDay: number): Date {
  if (dueDay < 1 || dueDay > 31) {
    throw new BusinessRuleError("El día de corte debe estar entre 1 y 31");
  }

  const current = toLocalDate(from);
  const candidate = toLocalMidnight(new Date(current.getFullYear(), current.getMonth(), dueDay));
  const currentMidnight = toLocalMidnight(current);

  if (candidate <= currentMidnight) {
    return addMonthsPreservingDay(candidate, 1);
  }

  return candidate;
}

export function daysBetweenInclusive(start: Date | string, end: Date | string): number {
  const startDate = toLocalDate(start);
  const endDate = toLocalDate(end);
  const diff = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY) + 1;
  return Math.max(0, diff);
}

export function daysUntilNextCutoff(paymentDate: Date | string, dueDay: number): number {
  const payment = toLocalDate(paymentDate);
  const cutoff = nextCutoffDate(payment, dueDay);
  return daysBetweenInclusive(payment, cutoff) - 1;
}

export function addDays(date: Date | string, days: number): Date {
  const result = toLocalDate(date);
  result.setDate(result.getDate() + days);
  return result;
}
