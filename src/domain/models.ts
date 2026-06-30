import type {
  BillingPeriodStatus,
  BillingPeriodType,
  CommunicationStatus,
  CommunicationType,
  PaymentCurrency,
  PaymentStatus,
  SubscriptionStatus,
  UserRole
} from "../domain/types.js";

export interface RequestContext {
  organizationId: string;
  userId: string;
  role: UserRole;
  clientId?: string;
}

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  dni: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  organizationId: string;
  name: string;
  priceUsd: number;
  lateFeeUsd: number;
  graceDays: number;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  organizationId: string;
  starlinkAccountId: string;
  kitId: string;
  planId: string;
  planName: string;
  clientId: string;
  priceUsd: number;
  status: SubscriptionStatus;
  dueDay: number;
  graceDays: number;
  lateFeeUsd: number;
  currentOwnerName: string;
  currentOwnerDni: string;
  starlinkEmail: string;
  starlinkPassword: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingPeriod {
  id: string;
  organizationId: string;
  subscriptionId: string;
  clientId: string;
  type: BillingPeriodType;
  startDate: string;
  endDate?: string;
  dueDate: string;
  status: BillingPeriodStatus;
  amountUsd: number;
  paidAmountUsd: number;
  surchargeUsd: number;
  suspensionDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  organizationId: string;
  billingPeriodId: string;
  subscriptionId: string;
  clientId: string;
  amount: number;
  currency: PaymentCurrency;
  exchangeRate: number;
  amountUsd: number;
  reference: string;
  proofImage?: string;
  paidAt: string;
  createdBy: string;
  confirmedBy?: string;
  confirmedAt?: string;
  voidedBy?: string;
  voidReason?: string;
  voidedAt?: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LateFee {
  id: string;
  organizationId: string;
  billingPeriodId: string;
  subscriptionId: string;
  amountUsd: number;
  status: "pending" | "applied" | "voided";
  createdAt: string;
  appliedAt?: string;
}

export interface Communication {
  id: string;
  organizationId: string;
  clientId: string;
  subscriptionId?: string;
  type: CommunicationType;
  channel: "whatsapp";
  provider: "twilio";
  status: CommunicationStatus;
  sentAt?: string;
  errorMessage?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityLog {
  id: string;
  organizationId: string;
  actorId: string;
  actorRole: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CronScheduleConfig {
  id: string;
  organizationId: string;
  scheduledHour: number;
  scheduledMinute: number;
  isActive: boolean;
  lastRunAt?: string;
  lastRunResult?: string;
  lastRunError?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Usuario del sistema con autenticación JWT.
 *
 * La colección en Firestore es `organizations/{organizationId}/users`.
 *
 * - `id`: UUID generado al crear el usuario.
 * - `email`: único por organización (no puede repetirse en la misma org).
 * - `passwordHash`: hash bcrypt del password (nunca se almacena en plaintext).
 * - `role`: `admin` (acceso total) o `client` (acceso a sus propios datos).
 * - `clientId`: solo para role `client`, referencia al Client de negocio.
 * - `isActive`: si `false`, no puede hacer login.
 */
export interface User {
  id: string;
  organizationId: string;
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  clientId?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserPublic = Omit<User, "passwordHash">;

export interface PaginationParams {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

