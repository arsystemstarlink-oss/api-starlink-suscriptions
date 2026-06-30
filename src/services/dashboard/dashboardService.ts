import {
  subscriptionRepository,
  billingPeriodRepository,
  paymentRepository,
  activityLogRepository,
  lateFeeRepository
} from "../../infrastructure/firestore/repositories.js";
import { BillingPeriodStatus, SubscriptionStatus } from "../../domain/types.js";
import { toDateString, addDays } from "../../domain/dateUtils.js";
import { roundMoney } from "../../domain/calculations.js";
import type { Subscription, BillingPeriod, RequestContext } from "../../domain/models.js";

export const dashboardService = {
  async getSummary(context: RequestContext) {
    const [subscriptions, payments, statusCounts, billingPeriods] = await Promise.all([
      subscriptionRepository.listAll(context.organizationId),
      paymentRepository.listRecent(context.organizationId, null, 50),
      subscriptionRepository.countByStatus(context.organizationId),
      billingPeriodRepository.listByStatus(context.organizationId, [
        BillingPeriodStatus.Pending,
        BillingPeriodStatus.Partial
      ])
    ]);

    const overdueCount = countOverdueSubscriptions(subscriptions, billingPeriods);

    const confirmedPayments = payments.filter((p) => p.status === "confirmed");
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthlyRevenue = confirmedPayments
      .filter((p) => p.confirmedAt?.startsWith(thisMonth))
      .reduce((sum, p) => sum + p.amountUsd, 0);

    const totalRevenue = confirmedPayments.reduce((sum, p) => sum + p.amountUsd, 0);

    const pendingPayments = payments.filter((p) => p.status === "registered").length;
    const totalDebt = await calculateTotalDebt(context.organizationId);

    const recentPayments = payments.slice(0, 5);

    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions: (statusCounts[SubscriptionStatus.Active] ?? 0),
      suspendedSubscriptions: (statusCounts[SubscriptionStatus.Suspended] ?? 0),
      overdueSubscriptions: overdueCount,
      pausedSubscriptions: (statusCounts[SubscriptionStatus.Paused] ?? 0),
      pendingPaymentsCount: pendingPayments,
      totalRevenueUsd: roundMoney(totalRevenue),
      monthlyRevenueUsd: roundMoney(monthlyRevenue),
      totalDebtUsd: roundMoney(totalDebt),
      recentPayments
    };
  },

  async getUrgentActions(context: RequestContext) {
    const [subscriptions, pendingPayments, billingPeriods] = await Promise.all([
      subscriptionRepository.listAll(context.organizationId),
      paymentRepository.listRecent(context.organizationId, "registered", 20),
      billingPeriodRepository.listByStatus(context.organizationId, [
        BillingPeriodStatus.Overdue,
        BillingPeriodStatus.Pending,
        BillingPeriodStatus.Partial
      ])
    ]);

    const overdueSubscriptions = subscriptions.filter((sub) => {
      if (sub.status !== SubscriptionStatus.Active) return false;
      const period = billingPeriods.find((p) => p.subscriptionId === sub.id);
      if (!period) return false;
      return new Date() > new Date(period.dueDate + "T23:59:59");
    });

    const today = new Date();
    const upcomingSuspensions: Array<{
      subscriptionId: string;
      starlinkAccountId: string;
      currentOwnerName: string;
      suspensionDate: string;
      daysUntilSuspension: number;
    }> = [];

    for (const period of billingPeriods) {
      const sub = subscriptions.find((s) => s.id === period.subscriptionId);
      if (!sub || sub.status !== SubscriptionStatus.Active) continue;

      const suspensionDate = addDays(new Date(period.dueDate), sub.graceDays);
      if (suspensionDate <= today) continue;

      const daysUntil = Math.ceil((suspensionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 7) {
        upcomingSuspensions.push({
          subscriptionId: sub.id,
          starlinkAccountId: sub.starlinkAccountId,
          currentOwnerName: sub.currentOwnerName,
          suspensionDate: toDateString(suspensionDate),
          daysUntilSuspension: daysUntil
        });
      }
    }

    upcomingSuspensions.sort((a, b) => a.daysUntilSuspension - b.daysUntilSuspension);

    return {
      pendingPayments,
      overdueSubscriptions: overdueSubscriptions.map((s) => ({
        id: s.id,
        starlinkAccountId: s.starlinkAccountId,
        currentOwnerName: s.currentOwnerName,
        status: s.status
      })),
      upcomingSuspensions
    };
  },

  async getWeekAgenda(context: RequestContext) {
    const today = new Date();
    const weekEnd = addDays(today, 7);
    const fromDate = toDateString(today);
    const toDate = toDateString(weekEnd);

    const [upcomingPeriods, subscriptions, recentActivity] = await Promise.all([
      billingPeriodRepository.listUpcomingDueDates(context.organizationId, fromDate, toDate),
      subscriptionRepository.listAll(context.organizationId),
      activityLogRepository.listRecent(context.organizationId, 20)
    ]);

    const upcomingDueThisWeek = upcomingPeriods.map((period) => {
      const sub = subscriptions.find((s) => s.id === period.subscriptionId);
      return {
        subscriptionId: period.subscriptionId,
        clientId: period.clientId,
        starlinkAccountId: sub?.starlinkAccountId ?? "",
        currentOwnerName: sub?.currentOwnerName ?? "",
        dueDate: period.dueDate,
        amountUsd: period.amountUsd,
        balanceUsd: roundMoney(period.amountUsd - period.paidAmountUsd)
      };
    });

    const upcomingSuspensionsThisWeek: Array<{
      subscriptionId: string;
      starlinkAccountId: string;
      currentOwnerName: string;
      suspensionDate: string;
      daysUntilSuspension: number;
    }> = [];

    const allPendingPeriods = await billingPeriodRepository.listByStatus(context.organizationId, [
      BillingPeriodStatus.Pending,
      BillingPeriodStatus.Partial
    ]);

    for (const period of allPendingPeriods) {
      const sub = subscriptions.find((s) => s.id === period.subscriptionId);
      if (!sub || sub.status !== SubscriptionStatus.Active) continue;

      const suspensionDate = addDays(new Date(period.dueDate), sub.graceDays);
      if (suspensionDate <= today || suspensionDate > weekEnd) continue;

      const daysUntil = Math.ceil((suspensionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      upcomingSuspensionsThisWeek.push({
        subscriptionId: sub.id,
        starlinkAccountId: sub.starlinkAccountId,
        currentOwnerName: sub.currentOwnerName,
        suspensionDate: toDateString(suspensionDate),
        daysUntilSuspension: daysUntil
      });
    }

    upcomingSuspensionsThisWeek.sort((a, b) => a.daysUntilSuspension - b.daysUntilSuspension);

    return {
      fromDate,
      toDate,
      upcomingDueThisWeek,
      upcomingSuspensionsThisWeek,
      recentActivity: recentActivity.slice(0, 15)
    };
  },

  async getNotificationsCount(context: RequestContext) {
    const [subscriptions, payments, billingPeriods] = await Promise.all([
      subscriptionRepository.listAll(context.organizationId),
      paymentRepository.listRecent(context.organizationId, "registered", 200),
      billingPeriodRepository.listByStatus(context.organizationId, [
        BillingPeriodStatus.Overdue,
        BillingPeriodStatus.Pending,
        BillingPeriodStatus.Partial
      ])
    ]);

    const pendingPaymentsCount = payments.filter((p) => p.status === "registered").length;

    const overdueCount = subscriptions.filter((sub) => {
      if (sub.status !== SubscriptionStatus.Active) return false;
      const period = billingPeriods.find(
        (p) => p.subscriptionId === sub.id && p.type === "regular"
      );
      if (!period) return false;
      return new Date() > new Date(period.dueDate + "T23:59:59");
    }).length;

    const today = new Date();
    let upcomingSuspensionsCount = 0;
    for (const period of billingPeriods) {
      const sub = subscriptions.find((s) => s.id === period.subscriptionId);
      if (!sub || sub.status !== SubscriptionStatus.Active) continue;

      const suspensionDate = addDays(new Date(period.dueDate), sub.graceDays);
      if (suspensionDate <= today) continue;

      const daysUntil = Math.ceil((suspensionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntil <= 7) {
        upcomingSuspensionsCount++;
      }
    }

    return {
      pendingPaymentsCount,
      overdueSubscriptionsCount: overdueCount,
      upcomingSuspensionsCount,
      total: pendingPaymentsCount + overdueCount + upcomingSuspensionsCount
    };
  }
};

function countOverdueSubscriptions(subscriptions: Subscription[], billingPeriods: BillingPeriod[]): number {
  const today = new Date();
  let count = 0;
  for (const sub of subscriptions) {
    if (sub.status !== SubscriptionStatus.Active) continue;
    const period = billingPeriods.find(
      (p) => p.subscriptionId === sub.id && p.type === "regular"
    );
    if (period && today > new Date(period.dueDate + "T23:59:59")) {
      count++;
    }
  }
  return count;
}

async function calculateTotalDebt(organizationId: string): Promise<number> {
  const periods = await billingPeriodRepository.listByStatus(organizationId, [
    BillingPeriodStatus.Overdue,
    BillingPeriodStatus.Partial
  ]);

  let total = 0;
  for (const period of periods) {
    const balance = roundMoney(period.amountUsd - period.paidAmountUsd);
    total += Math.max(0, balance);

    const lateFee = await lateFeeRepository.getByBillingPeriod(organizationId, period.id);
    if (lateFee) {
      total += lateFee.amountUsd;
    }
  }

  return total;
}
