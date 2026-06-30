import type {
  Client,
  Plan,
  Subscription,
  BillingPeriod,
  Payment,
  LateFee,
  Communication,
  ActivityLog,
  CronScheduleConfig,
  User,
  PaginatedResult,
  PaginationParams
} from "../../domain/models.js";
import { BillingPeriodStatus, CommunicationStatus, PaymentStatus } from "../../domain/types.js";

type Store<T> = Map<string, T>;

function nowIso() {
  return new Date().toISOString();
}

function paginate<T>(items: T[], page: number, limit: number): PaginatedResult<T> {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { data: items.slice(start, start + limit), page, limit, total, totalPages };
}

class InMemoryStore {
  clients: Store<Client> = new Map();
  plans: Store<Plan> = new Map();
  subscriptions: Store<Subscription> = new Map();
  billingPeriods: Store<BillingPeriod> = new Map();
  payments: Store<Payment> = new Map();
  lateFees: Store<LateFee> = new Map();
  communications: Store<Communication> = new Map();
  activityLogs: Store<ActivityLog> = new Map();
  cronConfigs: Store<CronScheduleConfig> = new Map();
  users: Store<User> = new Map();
  jobLocks: Store<Record<string, unknown>> = new Map();

  reset() {
    this.clients.clear();
    this.plans.clear();
    this.subscriptions.clear();
    this.billingPeriods.clear();
    this.payments.clear();
    this.lateFees.clear();
    this.communications.clear();
    this.activityLogs.clear();
    this.cronConfigs.clear();
    this.users.clear();
    this.jobLocks.clear();
  }
}

export const store = new InMemoryStore();

function fieldWhere<T>(items: T[], field: keyof T, value: unknown): T[] {
  return items.filter((item) => item[field] === value);
}

function fieldIn<T>(items: T[], field: keyof T, values: unknown[]): T[] {
  return items.filter((item) => values.includes(item[field]));
}

function sortBy<T>(items: T[], field: keyof T, direction: "asc" | "desc" = "asc"): T[] {
  return [...items].sort((a, b) => {
    const aVal = String(a[field] ?? "");
    const bVal = String(b[field] ?? "");
    return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });
}

/* ── clientRepository ── */

export const clientRepository = {
  async create(client: Omit<Client, "id" | "createdAt" | "updatedAt">): Promise<Client> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Client = { ...client, id, createdAt: now, updatedAt: now };
    store.clients.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Client | null> {
    const c = store.clients.get(id);
    return c?.organizationId === organizationId ? c : null;
  },

  async list(organizationId: string, pagination?: PaginationParams): Promise<PaginatedResult<Client>> {
    const items = sortBy(
      [...store.clients.values()].filter((c) => c.organizationId === organizationId),
      "createdAt",
      "desc"
    );
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    return paginate(items, page, limit);
  },

  async getByPhone(organizationId: string, phone: string): Promise<Client | null> {
    const matches = fieldWhere(
      [...store.clients.values()].filter((c) => c.organizationId === organizationId),
      "phone",
      phone
    );
    return matches[0] ?? null;
  },

  async getByDni(organizationId: string, dni: string): Promise<Client | null> {
    const matches = fieldWhere(
      [...store.clients.values()].filter((c) => c.organizationId === organizationId),
      "dni",
      dni
    );
    return matches[0] ?? null;
  },

  async getByEmail(organizationId: string, email: string): Promise<Client | null> {
    const matches = fieldWhere(
      [...store.clients.values()].filter((c) => c.organizationId === organizationId),
      "email",
      email
    );
    return matches[0] ?? null;
  },

  async update(id: string, organizationId: string, data: Partial<Client>): Promise<void> {
    const existing = store.clients.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.clients.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  },

  async delete(id: string, organizationId: string): Promise<void> {
    const existing = store.clients.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.clients.delete(id);
    }
  }
};

/* ── planRepository ── */

export const planRepository = {
  async create(plan: Omit<Plan, "id" | "createdAt" | "updatedAt">): Promise<Plan> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Plan = { ...plan, id, createdAt: now, updatedAt: now };
    store.plans.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Plan | null> {
    const p = store.plans.get(id);
    return p?.organizationId === organizationId ? p : null;
  },

  async getByName(organizationId: string, name: string): Promise<Plan | null> {
    const matches = fieldWhere(
      [...store.plans.values()].filter((p) => p.organizationId === organizationId),
      "name",
      name
    );
    return matches[0] ?? null;
  },

  async list(organizationId: string, includeInactive = false, pagination?: PaginationParams): Promise<PaginatedResult<Plan>> {
    let items = [...store.plans.values()].filter((p) => p.organizationId === organizationId);
    if (!includeInactive) {
      items = items.filter((p) => p.isActive);
    }
    items = sortBy(items, "createdAt", "asc");
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    return paginate(items, page, limit);
  },

  async update(id: string, organizationId: string, data: Partial<Plan>): Promise<void> {
    const existing = store.plans.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.plans.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  }
};

/* ── subscriptionRepository ── */

export const subscriptionRepository = {
  async create(subscription: Omit<Subscription, "id" | "createdAt" | "updatedAt">): Promise<Subscription> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Subscription = { ...subscription, id, createdAt: now, updatedAt: now };
    store.subscriptions.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Subscription | null> {
    const s = store.subscriptions.get(id);
    return s?.organizationId === organizationId ? s : null;
  },

  async getByStarlinkAccountId(organizationId: string, starlinkAccountId: string): Promise<Subscription | null> {
    const matches = fieldWhere(
      [...store.subscriptions.values()].filter((s) => s.organizationId === organizationId),
      "starlinkAccountId",
      starlinkAccountId
    );
    return matches[0] ?? null;
  },

  async update(id: string, organizationId: string, data: Partial<Subscription>): Promise<void> {
    const existing = store.subscriptions.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.subscriptions.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  },

  async listAll(organizationId: string): Promise<Subscription[]> {
    return [...store.subscriptions.values()].filter((s) => s.organizationId === organizationId);
  },

  async listByClientId(organizationId: string, clientId: string): Promise<Subscription[]> {
    const all = [...store.subscriptions.values()].filter((s) => s.organizationId === organizationId);
    return sortBy(fieldWhere(all, "clientId", clientId), "createdAt");
  },

  async listByPlanId(organizationId: string, planId: string): Promise<Subscription[]> {
    const all = [...store.subscriptions.values()].filter((s) => s.organizationId === organizationId);
    return sortBy(fieldWhere(all, "planId", planId), "createdAt");
  }
};

/* ── billingPeriodRepository ── */

export const billingPeriodRepository = {
  async create(period: Omit<BillingPeriod, "id" | "createdAt" | "updatedAt">): Promise<BillingPeriod> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: BillingPeriod = { ...period, id, createdAt: now, updatedAt: now };
    store.billingPeriods.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<BillingPeriod | null> {
    const p = store.billingPeriods.get(id);
    return p?.organizationId === organizationId ? p : null;
  },

  async getBySubscription(organizationId: string, subscriptionId: string): Promise<BillingPeriod[]> {
    const all = [...store.billingPeriods.values()].filter((p) => p.organizationId === organizationId);
    return sortBy(fieldWhere(all, "subscriptionId", subscriptionId), "dueDate");
  },

  async getActiveRegular(organizationId: string, subscriptionId: string): Promise<BillingPeriod | null> {
    const all = [...store.billingPeriods.values()].filter((p) => p.organizationId === organizationId);
    const filtered = all.filter((p) =>
      p.subscriptionId === subscriptionId &&
      p.type === ("regular" as any) &&
      [BillingPeriodStatus.Pending, BillingPeriodStatus.Partial, BillingPeriodStatus.Overdue].includes(p.status as any)
    );
    return filtered[0] ?? null;
  },

  async update(id: string, organizationId: string, data: Partial<BillingPeriod>): Promise<void> {
    const existing = store.billingPeriods.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.billingPeriods.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  },

  getRef(organizationId: string, id: string) {
    return { id, organizationId };
  },

  async listDueForDailyJob(organizationId: string, today: string): Promise<BillingPeriod[]> {
    const all = [...store.billingPeriods.values()].filter((p) => p.organizationId === organizationId);
    return all.filter((p) =>
      p.dueDate <= today &&
      [BillingPeriodStatus.Pending, BillingPeriodStatus.Partial].includes(p.status as any)
    );
  }
};

/* ── paymentRepository ── */

export const paymentRepository = {
  async create(payment: Omit<Payment, "id" | "createdAt" | "updatedAt">): Promise<Payment> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Payment = { ...payment, id, createdAt: now, updatedAt: now };
    store.payments.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Payment | null> {
    const p = store.payments.get(id);
    return p?.organizationId === organizationId ? p : null;
  },

  async getByReference(organizationId: string, reference: string): Promise<Payment | null> {
    const all = [...store.payments.values()].filter(
      (p) => p.organizationId === organizationId && p.reference === reference && p.status === PaymentStatus.Confirmed
    );
    return all[0] ?? null;
  },

  async update(id: string, organizationId: string, data: Partial<Payment>): Promise<void> {
    const existing = store.payments.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.payments.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  },

  getRef(organizationId: string, id: string) {
    return { id, organizationId };
  },

  async listByBillingPeriod(organizationId: string, billingPeriodId: string): Promise<Payment[]> {
    const all = [...store.payments.values()].filter((p) => p.organizationId === organizationId);
    return sortBy(fieldWhere(all, "billingPeriodId", billingPeriodId), "createdAt");
  },

  async listBySubscription(organizationId: string, subscriptionId: string): Promise<Payment[]> {
    const all = [...store.payments.values()].filter((p) => p.organizationId === organizationId);
    return sortBy(fieldWhere(all, "subscriptionId", subscriptionId), "createdAt");
  },

  async listByClientId(organizationId: string, clientId: string, order: "asc" | "desc" = "desc"): Promise<Payment[]> {
    const all = [...store.payments.values()].filter((p) => p.organizationId === organizationId);
    return sortBy(fieldWhere(all, "clientId", clientId), "createdAt", order);
  }
};

/* ── lateFeeRepository ── */

export const lateFeeRepository = {
  async create(lateFee: Omit<LateFee, "id" | "createdAt">): Promise<LateFee> {
    const id = crypto.randomUUID();
    const data: LateFee = { ...lateFee, id, createdAt: nowIso() };
    store.lateFees.set(id, data);
    return data;
  },

  async getByBillingPeriod(organizationId: string, billingPeriodId: string): Promise<LateFee | null> {
    const all = [...store.lateFees.values()].filter(
      (f) => f.organizationId === organizationId && f.billingPeriodId === billingPeriodId && f.status === "applied"
    );
    return all[0] ?? null;
  }
};

/* ── communicationRepository ── */

export const communicationRepository = {
  async create(communication: Omit<Communication, "id" | "createdAt">): Promise<Communication> {
    const id = crypto.randomUUID();
    const data: Communication = { ...communication, status: communication.status || CommunicationStatus.Queued, createdAt: nowIso(), id };
    store.communications.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Communication | null> {
    const c = store.communications.get(id);
    return c?.organizationId === organizationId ? c : null;
  },

  async update(id: string, organizationId: string, data: Partial<Communication>): Promise<void> {
    const existing = store.communications.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.communications.set(id, { ...existing, ...data });
    }
  },

  async existsForEvent(organizationId: string, subscriptionId: string, type: string, billingPeriodId: string): Promise<boolean> {
    const all = [...store.communications.values()].filter(
      (c) => c.organizationId === organizationId && c.subscriptionId === subscriptionId && (c.type as string) === type
    );
    return all.some((c) => (c.payload as any)?.billingPeriodId === billingPeriodId);
  },

  async listByClient(organizationId: string, clientId: string, limit = 100): Promise<Communication[]> {
    const all = [...store.communications.values()].filter(
      (c) => c.organizationId === organizationId && c.clientId === clientId
    );
    return all.slice(0, limit).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async saveReceived(communication: Omit<Communication, "id" | "createdAt">): Promise<Communication> {
    const id = crypto.randomUUID();
    const data: Communication = { ...communication, id, status: CommunicationStatus.Received, createdAt: nowIso() };
    store.communications.set(id, data);
    return data;
  }
};

/* ── activityLogRepository ── */

export const activityLogRepository = {
  async create(log: Omit<ActivityLog, "id" | "createdAt">): Promise<ActivityLog> {
    const id = crypto.randomUUID();
    const data: ActivityLog = { ...log, id, createdAt: nowIso() };
    store.activityLogs.set(id, data);
    return data;
  }
};

/* ── jobLockRepository ── */

export const jobLockRepository = {
  async tryAcquire(organizationId: string, date: string, jobType: string): Promise<boolean> {
    const docId = `${date}_${jobType}`;
    if (store.jobLocks.has(docId)) return false;
    store.jobLocks.set(docId, { organizationId, date, jobType, status: "running", startedAt: nowIso() });
    return true;
  },

  async release(organizationId: string, date: string, jobType: string): Promise<void> {
    const docId = `${date}_${jobType}`;
    store.jobLocks.set(docId, { organizationId, date, jobType, status: "completed", completedAt: nowIso() });
  }
};

/* ── cronConfigRepository ── */

export const cronConfigRepository = {
  async get(organizationId: string): Promise<CronScheduleConfig | null> {
    return store.cronConfigs.get(`${organizationId}_daily`) ?? null;
  },

  async upsert(organizationId: string, data: Partial<Omit<CronScheduleConfig, "id" | "organizationId" | "createdAt" | "updatedAt">>): Promise<CronScheduleConfig> {
    const key = `${organizationId}_daily`;
    const existing = store.cronConfigs.get(key);
    const now = nowIso();
    if (existing) {
      const updated = { ...existing, ...data, updatedAt: now };
      store.cronConfigs.set(key, updated);
      return updated;
    }
    const config: CronScheduleConfig = {
      id: "daily",
      organizationId,
      scheduledHour: 8,
      scheduledMinute: 0,
      isActive: false,
      createdAt: now,
      updatedAt: now,
      ...data
    };
    store.cronConfigs.set(key, config);
    return config;
  },

  async updateLastRun(organizationId: string, result: string, error?: string): Promise<void> {
    const key = `${organizationId}_daily`;
    const existing = store.cronConfigs.get(key);
    if (existing) {
      const now = nowIso();
      store.cronConfigs.set(key, { ...existing, lastRunAt: now, lastRunResult: result, lastRunError: error ?? undefined, updatedAt: now });
    }
  }
};

/* ── userRepository ── */

export const userRepository = {
  async create(user: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: User = { ...user, id, createdAt: now, updatedAt: now };
    store.users.set(id, data);
    return data;
  },

  async getById(organizationId: string, id: string): Promise<User | null> {
    const u = store.users.get(id);
    return u?.organizationId === organizationId ? u : null;
  },

  async getByEmail(organizationId: string, email: string): Promise<User | null> {
    const matches = fieldWhere(
      [...store.users.values()].filter((u) => u.organizationId === organizationId),
      "email",
      email
    );
    return matches[0] ?? null;
  },

  async list(organizationId: string): Promise<User[]> {
    return [...store.users.values()].filter((u) => u.organizationId === organizationId);
  },

  async update(id: string, organizationId: string, data: Partial<Omit<User, "id" | "organizationId" | "createdAt">>): Promise<void> {
    const existing = store.users.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.users.set(id, { ...existing, ...data, updatedAt: nowIso() });
    }
  },

  async delete(id: string, organizationId: string): Promise<void> {
    const existing = store.users.get(id);
    if (existing && existing.organizationId === organizationId) {
      store.users.delete(id);
    }
  }
};

/* ── Firestore utility mocks ── */

export const FieldValue = {
  increment: (value: number) => ({ __type: "increment", value })
};

export async function runFirestoreTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
  const mockTransaction = {
    update: (ref: any, data: Record<string, unknown>) => {
      if (ref.__type === "payment") {
        const payment = store.payments.get(ref.id);
        if (payment) store.payments.set(ref.id, { ...payment, ...data, updatedAt: nowIso() } as any);
      } else if (ref.__type === "billingPeriod") {
        const period = store.billingPeriods.get(ref.id);
        if (period) {
          const resolved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && (v as any).__type === "increment") {
              resolved[k] = ((period as any)[k] ?? 0) + (v as any).value;
            } else {
              resolved[k] = v;
            }
          }
          store.billingPeriods.set(ref.id, { ...period, ...resolved, updatedAt: nowIso() } as any);
        }
      }
    }
  };
  return fn(mockTransaction);
}

export function getFirestore() {
  return {};
}

export { getFirestore as getFirestoreInstance };
