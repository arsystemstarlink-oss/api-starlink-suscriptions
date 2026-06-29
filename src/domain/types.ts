export enum SubscriptionStatus {
  Paused = "paused",
  Active = "active",
  Suspended = "suspended",
  Cancelled = "cancelled"
}

export enum BillingPeriodStatus {
  Pending = "pending",
  Partial = "partial",
  Paid = "paid",
  Overdue = "overdue",
  Suspended = "suspended"
}

export enum BillingPeriodType {
  Regular = "regular",
  Advance = "advance"
}

export enum PaymentStatus {
  Registered = "registered",
  Confirmed = "confirmed",
  Voided = "voided"
}

export enum PaymentCurrency {
  USD = "USD",
  USDT = "USDT",
  Bs = "Bs",
  Zinli = "Zinli"
}

export enum CommunicationType {
  PaymentReminder = "payment_reminder",
  Overdue = "overdue",
  Suspended = "suspended",
  PaymentConfirmed = "payment_confirmed",
  Manual = "manual",
  Received = "received"
}

export enum CommunicationStatus {
  Queued = "queued",
  Sent = "sent",
  Received = "received",
  Failed = "failed"
}

export enum UserRole {
  Admin = "admin",
  Client = "client"
}
