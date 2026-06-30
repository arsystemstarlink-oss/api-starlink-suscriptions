import {
  FieldValue,
  type DocumentData,
  type QueryDocumentSnapshot
} from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { getFirestore, sanitizeForFirestore } from "./firestore.js";
import type {
  ActivityLog,
  BillingPeriod,
  Client,
  Communication,
  CronScheduleConfig,
  LateFee,
  PaginatedResult,
  PaginationParams,
  Payment,
  Plan,
  Subscription,
  User
} from "../../domain/models.js";
import {
  BillingPeriodStatus,
  BillingPeriodType,
  CommunicationStatus,
  PaymentStatus
} from "../../domain/types.js";

function db(): Firestore {
  return getFirestore();
}

export function orgCol(organizationId: string, name: string) {
  return db().collection("organizations").doc(organizationId).collection(name);
}

function nowIso(): string {
  return new Date().toISOString();
}

function toData<T>(snapshot: QueryDocumentSnapshot<DocumentData> | { data: () => DocumentData | undefined }): T {
  const data = snapshot.data();
  if (!data) {
    throw new Error("Documento sin datos");
  }
  return data as T;
}

function paginateItems<T>(items: T[], page: number, limit: number): PaginatedResult<T> {
  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const data = items.slice(start, start + limit);
  return { data, page, limit, total, totalPages };
}

export const clientRepository = {
  async create(client: Omit<Client, "id" | "createdAt" | "updatedAt">): Promise<Client> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Client = { ...client, id, createdAt: now, updatedAt: now };
    await orgCol(client.organizationId, "clients").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Client | null> {
    const snapshot = await orgCol(organizationId, "clients").doc(id).get();
    return snapshot.exists ? toData<Client>(snapshot) : null;
  },

  async list(organizationId: string, pagination?: PaginationParams): Promise<PaginatedResult<Client>> {
    const snapshot = await orgCol(organizationId, "clients")
      .orderBy("createdAt", "desc")
      .get();
    const items = snapshot.docs.map((doc: QueryDocumentSnapshot) => toData<Client>(doc));
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    return paginateItems(items, page, limit);
  },

  async getByPhone(organizationId: string, phone: string): Promise<Client | null> {
    const snapshot = await orgCol(organizationId, "clients")
      .where("phone", "==", phone)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Client>(snapshot.docs[0]);
  },

  async getByDni(organizationId: string, dni: string): Promise<Client | null> {
    const snapshot = await orgCol(organizationId, "clients")
      .where("dni", "==", dni)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Client>(snapshot.docs[0]);
  },

  async getByEmail(organizationId: string, email: string): Promise<Client | null> {
    const snapshot = await orgCol(organizationId, "clients")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Client>(snapshot.docs[0]);
  },


  async update(id: string, organizationId: string, data: Partial<Client>): Promise<void> {
    await orgCol(organizationId, "clients").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  },

  async delete(id: string, organizationId: string): Promise<void> {
    await orgCol(organizationId, "clients").doc(id).delete();
  }
};

export const planRepository = {
  async create(plan: Omit<Plan, "id" | "createdAt" | "updatedAt">): Promise<Plan> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Plan = { ...plan, id, createdAt: now, updatedAt: now };
    await orgCol(plan.organizationId, "plans").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Plan | null> {
    const snapshot = await orgCol(organizationId, "plans").doc(id).get();
    return snapshot.exists ? toData<Plan>(snapshot) : null;
  },

  async getByName(organizationId: string, name: string): Promise<Plan | null> {
    const snapshot = await orgCol(organizationId, "plans")
      .where("name", "==", name)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Plan>(snapshot.docs[0]);
  },

  async list(organizationId: string, includeInactive = false, pagination?: PaginationParams): Promise<PaginatedResult<Plan>> {
    const baseQuery = includeInactive
      ? orgCol(organizationId, "plans").orderBy("createdAt", "asc")
      : orgCol(organizationId, "plans")
          .where("isActive", "==", true)
          .orderBy("createdAt", "asc");

    const snapshot = await baseQuery.get();
    const items = snapshot.docs.map((doc: QueryDocumentSnapshot) => toData<Plan>(doc));
    const page = pagination?.page ?? 1;
    const limit = pagination?.limit ?? 20;
    return paginateItems(items, page, limit);
  },

  async update(id: string, organizationId: string, data: Partial<Plan>): Promise<void> {
    await orgCol(organizationId, "plans").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  }
};

export const subscriptionRepository = {
  async create(subscription: Omit<Subscription, "id" | "createdAt" | "updatedAt">): Promise<Subscription> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Subscription = { ...subscription, id, createdAt: now, updatedAt: now };
    await orgCol(subscription.organizationId, "subscriptions").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Subscription | null> {
    const snapshot = await orgCol(organizationId, "subscriptions").doc(id).get();
    return snapshot.exists ? toData<Subscription>(snapshot) : null;
  },

  async getByStarlinkAccountId(organizationId: string, starlinkAccountId: string): Promise<Subscription | null> {
    const snapshot = await orgCol(organizationId, "subscriptions")
      .where("starlinkAccountId", "==", starlinkAccountId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Subscription>(snapshot.docs[0]);
  },

  async update(id: string, organizationId: string, data: Partial<Subscription>): Promise<void> {
    await orgCol(organizationId, "subscriptions").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  },

  getRef(organizationId: string, id: string) {
    return orgCol(organizationId, "subscriptions").doc(id);
  },

  async listAll(organizationId: string): Promise<Subscription[]> {
    const snapshot = await orgCol(organizationId, "subscriptions").get();
    return snapshot.docs.map((item) => toData<Subscription>(item));
  },

  async listByClientId(organizationId: string, clientId: string): Promise<Subscription[]> {
    const snapshot = await orgCol(organizationId, "subscriptions")
      .where("clientId", "==", clientId)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map((item) => toData<Subscription>(item));
  },

  async listByPlanId(organizationId: string, planId: string): Promise<Subscription[]> {
    const snapshot = await orgCol(organizationId, "subscriptions")
      .where("planId", "==", planId)
      .get();

    return snapshot.docs
      .map((item) => toData<Subscription>(item))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
};

export const billingPeriodRepository = {
  async create(period: Omit<BillingPeriod, "id" | "createdAt" | "updatedAt">): Promise<BillingPeriod> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: BillingPeriod = { ...period, id, createdAt: now, updatedAt: now };
    await orgCol(period.organizationId, "billingPeriods").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<BillingPeriod | null> {
    const snapshot = await orgCol(organizationId, "billingPeriods").doc(id).get();
    return snapshot.exists ? toData<BillingPeriod>(snapshot) : null;
  },

  async getBySubscription(organizationId: string, subscriptionId: string): Promise<BillingPeriod[]> {
    const snapshot = await orgCol(organizationId, "billingPeriods")
      .where("subscriptionId", "==", subscriptionId)
      .orderBy("dueDate", "asc")
      .get();

    return snapshot.docs.map((item) => toData<BillingPeriod>(item));
  },

  async getActiveRegular(
    organizationId: string,
    subscriptionId: string
  ): Promise<BillingPeriod | null> {
    const snapshot = await orgCol(organizationId, "billingPeriods")
      .where("subscriptionId", "==", subscriptionId)
      .where("type", "==", BillingPeriodType.Regular)
      .where("status", "in", [
        BillingPeriodStatus.Pending,
        BillingPeriodStatus.Partial,
        BillingPeriodStatus.Overdue
      ])
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<BillingPeriod>(snapshot.docs[0]);
  },

  async update(id: string, organizationId: string, data: Partial<BillingPeriod>): Promise<void> {
    await orgCol(organizationId, "billingPeriods").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  },

  getRef(organizationId: string, id: string) {
    return orgCol(organizationId, "billingPeriods").doc(id);
  },

  async listDueForDailyJob(organizationId: string, today: string): Promise<BillingPeriod[]> {
    const snapshot = await orgCol(organizationId, "billingPeriods")
      .where("dueDate", "<=", today)
      .where("status", "in", [BillingPeriodStatus.Pending, BillingPeriodStatus.Partial])
      .get();

    return snapshot.docs.map((item) => toData<BillingPeriod>(item));
  }
};

export const paymentRepository = {
  async create(payment: Omit<Payment, "id" | "createdAt" | "updatedAt">): Promise<Payment> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: Payment = { ...payment, id, createdAt: now, updatedAt: now };
    await orgCol(payment.organizationId, "payments").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Payment | null> {
    const snapshot = await orgCol(organizationId, "payments").doc(id).get();
    return snapshot.exists ? toData<Payment>(snapshot) : null;
  },

  async getByReference(
    organizationId: string,
    reference: string
  ): Promise<Payment | null> {
    const snapshot = await orgCol(organizationId, "payments")
      .where("reference", "==", reference)
      .where("status", "==", PaymentStatus.Confirmed)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<Payment>(snapshot.docs[0]);
  },

  async update(
    id: string,
    organizationId: string,
    data: Partial<Payment>
  ): Promise<void> {
    await orgCol(organizationId, "payments").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  },

  getRef(organizationId: string, id: string) {
    return orgCol(organizationId, "payments").doc(id);
  },

  async listByBillingPeriod(
    organizationId: string,
    billingPeriodId: string
  ): Promise<Payment[]> {
    const snapshot = await orgCol(organizationId, "payments")
      .where("billingPeriodId", "==", billingPeriodId)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map((item) => toData<Payment>(item));
  },

  async listBySubscription(
    organizationId: string,
    subscriptionId: string
  ): Promise<Payment[]> {
    const snapshot = await orgCol(organizationId, "payments")
      .where("subscriptionId", "==", subscriptionId)
      .orderBy("createdAt", "asc")
      .get();

    return snapshot.docs.map((item) => toData<Payment>(item));
  },

  async listByClientId(
    organizationId: string,
    clientId: string,
    order: "asc" | "desc" = "desc"
  ): Promise<Payment[]> {
    const snapshot = await orgCol(organizationId, "payments")
      .where("clientId", "==", clientId)
      .orderBy("createdAt", order)
      .get();

    return snapshot.docs.map((item) => toData<Payment>(item));
  }
};

export const lateFeeRepository = {
  async create(lateFee: Omit<LateFee, "id" | "createdAt">): Promise<LateFee> {
    const id = crypto.randomUUID();
    const data: LateFee = { ...lateFee, id, createdAt: nowIso() };
    await orgCol(lateFee.organizationId, "lateFees").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getByBillingPeriod(
    organizationId: string,
    billingPeriodId: string
  ): Promise<LateFee | null> {
    const snapshot = await orgCol(organizationId, "lateFees")
      .where("billingPeriodId", "==", billingPeriodId)
      .where("status", "==", "applied")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return toData<LateFee>(snapshot.docs[0]);
  },

  getRef(organizationId: string, id: string) {
    return orgCol(organizationId, "lateFees").doc(id);
  }
};

export const communicationRepository = {
  async create(communication: Omit<Communication, "id" | "createdAt">): Promise<Communication> {
    const id = crypto.randomUUID();
    const data: Communication = {
      ...communication,
      id,
      status: communication.status || CommunicationStatus.Queued,
      createdAt: nowIso()
    };
    await orgCol(communication.organizationId, "communications").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  async getById(organizationId: string, id: string): Promise<Communication | null> {
    const snapshot = await orgCol(organizationId, "communications").doc(id).get();
    return snapshot.exists ? toData<Communication>(snapshot) : null;
  },

  async update(
    id: string,
    organizationId: string,
    data: Partial<Communication>
  ): Promise<void> {
    await orgCol(organizationId, "communications").doc(id).update(sanitizeForFirestore(data));
  },

  async existsForEvent(
    organizationId: string,
    subscriptionId: string,
    type: string,
    billingPeriodId: string
  ): Promise<boolean> {
    const snapshot = await orgCol(organizationId, "communications")
      .where("subscriptionId", "==", subscriptionId)
      .where("type", "==", type)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return false;
    }

    const hasMatchingEvent = snapshot.docs.some((doc) => {
      const data = doc.data() as Communication;
      return data.payload?.billingPeriodId === billingPeriodId;
    });

    return hasMatchingEvent;
  },

  async listByClient(
    organizationId: string,
    clientId: string,
    limit = 100
  ): Promise<Communication[]> {
    const snapshot = await orgCol(organizationId, "communications")
      .where("clientId", "==", clientId)
      .limit(limit)
      .get();

    return snapshot.docs
      .map((doc) => toData<Communication>(doc))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async saveReceived(communication: Omit<Communication, "id" | "createdAt">): Promise<Communication> {
    const id = crypto.randomUUID();
    const data: Communication = {
      ...communication,
      id,
      status: CommunicationStatus.Received,
      createdAt: nowIso()
    };
    await orgCol(communication.organizationId, "communications").doc(id).set(sanitizeForFirestore(data));
    return data;
  }
};

export const activityLogRepository = {
  async create(log: Omit<ActivityLog, "id" | "createdAt">): Promise<ActivityLog> {
    const id = crypto.randomUUID();
    const data: ActivityLog = { ...log, id, createdAt: nowIso() };
    await orgCol(log.organizationId, "activityLogs").doc(id).set(sanitizeForFirestore(data));
    return data;
  }
};

export const jobLockRepository = {
  /**
   * Intenta adquirir un bloqueo para ejecutar un job.
   *
   * CRÍTICO: Si el lock anterior está "running" pero empezó hace más de 1 hora,
   * se considera "stuck" (resultado de un crash) y se permite re-adquirirlo.
   * Esto previene que el job quede muerto permanentemente si el proceso crashea.
   */
  async tryAcquire(organizationId: string, date: string, jobType: string): Promise<boolean> {
    const docId = `${date}_${jobType}`;
    const docRef = orgCol(organizationId, "jobLocks").doc(docId);

    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      // No existe aún, crear nuevo lock
      try {
        await docRef.create(sanitizeForFirestore({
          organizationId,
          date,
          jobType,
          status: "running",
          startedAt: nowIso()
        }));
        return true;
      } catch {
        // Race condition: otro proceso lo creó primero
        return false;
      }
    }

    const lockData = snapshot.data() as { status: string; startedAt: string };

    // Si ya se ejecutó exitosamente, no volver a ejecutar
    if (lockData.status === "completed") {
      return false;
    }

    // Si falló explícitamente, permitir re-intento
    if (lockData.status === "failed") {
      await docRef.update(sanitizeForFirestore({
        status: "running",
        startedAt: nowIso()
      }));
      return true;
    }

    // Si está "running", verificar si está stuck (más de 1 hora)
    if (lockData.status === "running") {
      const startedAt = new Date(lockData.startedAt);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      if (startedAt < oneHourAgo) {
        // Lock expirado, tomar ownership
        console.warn(`Job lock encontrado en estado "running" desde hace más de 1 hora. Tomando ownership.`);
        await docRef.update(sanitizeForFirestore({
          status: "running",
          startedAt: nowIso()
        }));
        return true;
      }

      // Lock activo, no ejecutar
      return false;
    }

    return false;
  },

  async release(organizationId: string, date: string, jobType: string, status: "completed" | "failed" = "completed"): Promise<void> {
    const docId = `${date}_${jobType}`;
    await orgCol(organizationId, "jobLocks").doc(docId).update(sanitizeForFirestore({
      status,
      completedAt: nowIso()
    }));
  }
};

const DEFAULT_CRON_ID = "daily";

/**
 * Repositorio para gestionar la configuración del cron diario en Firestore.
 *
 * La configuración se almacena en:
 * `organizations/{organizationId}/cronConfig/daily`
 *
 * Contiene: hora (formato 24h), minuto, si está activo, y metadatos de última ejecución.
 */
export const cronConfigRepository = {
  /**
   * Obtiene la configuración actual de cron para una organización.
   * @param organizationId - ID de la organización.
   * @returns La configuración si existe, `null` si nunca se ha configurado.
   */
  async get(organizationId: string): Promise<CronScheduleConfig | null> {
    const snapshot = await orgCol(organizationId, "cronConfig").doc(DEFAULT_CRON_ID).get();
    return snapshot.exists ? toData<CronScheduleConfig>(snapshot) : null;
  },

  /**
   * Crea o actualiza la configuración de cron. Si no existe, la crea con valores por defecto.
   * @param organizationId - ID de la organización.
   * @param data - Campos a actualizar: `scheduledHour` (0–23), `scheduledMinute` (0–59), `isActive`.
   * @returns La configuración resultante tras aplicar los cambios.
   */
  async upsert(organizationId: string, data: Partial<Omit<CronScheduleConfig, "id" | "organizationId" | "createdAt" | "updatedAt">>): Promise<CronScheduleConfig> {
    const existing = await this.get(organizationId);
    const now = nowIso();
    const docRef = orgCol(organizationId, "cronConfig").doc(DEFAULT_CRON_ID);

    if (existing) {
      const updateData = sanitizeForFirestore({
        ...data,
        updatedAt: now
      });
      await docRef.update(updateData);
      return { ...existing, ...data, updatedAt: now };
    }

    const config: CronScheduleConfig = {
      id: DEFAULT_CRON_ID,
      organizationId,
      scheduledHour: 8,
      scheduledMinute: 0,
      isActive: false,
      createdAt: now,
      updatedAt: now,
      ...data
    };
    await docRef.set(sanitizeForFirestore(config));
    return config;
  },

  /**
   * Registra el resultado de la última ejecución del cron.
   * @param organizationId - ID de la organización.
   * @param result - Estado del job (p.ej. `"completed"`, `"already_executed"`, `"failed"`).
   * @param error - Mensaje de error si la ejecución falló, o los errores concatenados si hubo errores parciales.
   */
  async updateLastRun(organizationId: string, result: string, error?: string): Promise<void> {
    const docRef = orgCol(organizationId, "cronConfig").doc(DEFAULT_CRON_ID);
    const now = nowIso();
    await docRef.update(sanitizeForFirestore({
      lastRunAt: now,
      lastRunResult: result,
      lastRunError: error ?? null,
      updatedAt: now
    }));
  }
};

/**
 * Repositorio para la gestión de usuarios con autenticación JWT.
 *
 * Colección en Firestore: `organizations/{organizationId}/users`
 */
export const userRepository = {
  /**
   * Crea un nuevo usuario.
   * @param user - Datos del usuario (sin id ni timestamps).
   * @returns El usuario creado con id, createdAt y updatedAt.
   */
  async create(user: Omit<User, "id" | "createdAt" | "updatedAt">): Promise<User> {
    const id = crypto.randomUUID();
    const now = nowIso();
    const data: User = { ...user, id, createdAt: now, updatedAt: now };
    await orgCol(user.organizationId, "users").doc(id).set(sanitizeForFirestore(data));
    return data;
  },

  /**
   * Obtiene un usuario por su ID.
   * @param organizationId
   * @param id
   * @returns El usuario si existe, o `null`.
   */
  async getById(organizationId: string, id: string): Promise<User | null> {
    const snapshot = await orgCol(organizationId, "users").doc(id).get();
    return snapshot.exists ? toData<User>(snapshot) : null;
  },

  /**
   * Busca un usuario por email dentro de una organización.
   * @param organizationId
   * @param email
   * @returns El usuario si existe, o `null`.
   */
  async getByEmail(organizationId: string, email: string): Promise<User | null> {
    const snapshot = await orgCol(organizationId, "users")
      .where("email", "==", email)
      .limit(1)
      .get();
    return snapshot.empty ? null : toData<User>(snapshot.docs[0]);
  },

  /**
   * Lista todos los usuarios de una organización.
   * @param organizationId
   */
  async list(organizationId: string): Promise<User[]> {
    const snapshot = await orgCol(organizationId, "users").get();
    return snapshot.docs.map((doc) => toData<User>(doc));
  },

  /**
   * Actualiza los campos de un usuario.
   * @param id
   * @param organizationId
   * @param data - Campos a actualizar.
   */
  async update(id: string, organizationId: string, data: Partial<Omit<User, "id" | "organizationId" | "createdAt">>): Promise<void> {
    await orgCol(organizationId, "users").doc(id).update(sanitizeForFirestore({
      ...data,
      updatedAt: nowIso()
    }));
  },

  /**
   * Elimina un usuario.
   * @param id
   * @param organizationId
   */
  async delete(id: string, organizationId: string): Promise<void> {
    await orgCol(organizationId, "users").doc(id).delete();
  }
};

export async function runFirestoreTransaction<T>(
  fn: (transaction: Transaction) => Promise<T>
): Promise<T> {
  return db().runTransaction(fn);
}

export { FieldValue };
export { getFirestore as getFirestoreInstance };
