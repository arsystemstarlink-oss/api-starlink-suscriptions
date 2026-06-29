import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).default({ page: 1, limit: 20 });

export const createClientSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  dni: z.string().min(1, "El DNI es obligatorio"),
  phone: z.string().min(7, "El teléfono es obligatorio"),
  address: z.string().min(1, "La dirección es obligatoria")
});

export const updateClientSchema = z.object({
  name: z.string().min(1).optional(),
  dni: z.string().min(1).optional(),
  phone: z.string().min(7).optional(),
  address: z.string().optional()
}).refine(obj => Object.keys(obj).length > 0, {
  message: "Debe enviar al menos un campo para actualizar"
});

export const createSubscriptionSchema = z.object({
  clientId: z.string().min(1),
  code: z.string().min(1),
  starlinkAccountId: z.string().min(1),
  kitId: z.string().min(1),
  planId: z.string().min(1),
  dueDay: z.coerce.number().int().min(1).max(31)
});

export const registerPaymentSchema = z.object({
  billingPeriodId: z.string().min(1, "El billingPeriodId es obligatorio"),
  amount: z.coerce.number().min(0.01, "El monto debe ser mayor a 0"),
  currency: z.string().min(1, "La moneda es obligatoria"),
  exchangeRate: z.coerce.number().positive("La tasa de cambio debe ser mayor a 0"),
  reference: z.string().min(1, "La referencia es obligatoria"),
  proofImage: z.string().min(1, "La imagen del comprobante es obligatoria"),
  paidAt: z.string().optional()
});

export const confirmPaymentSchema = z.object({
  confirmedAt: z.string().datetime().optional()
});

export const voidPaymentSchema = z.object({
  reason: z.string().min(1)
});

export const reactivateSubscriptionSchema = z.object({
  paymentIds: z.array(z.string().min(1)).min(1),
  expectedTotalUsd: z.coerce.number().min(0.01)
});

export const manualSuspendSchema = z.object({
  reason: z.string().min(1)
});

export const transferSubscriptionSchema = z.object({
  newClientId: z.string().min(1),
  currentOwnerName: z.string().min(1),
  currentOwnerDni: z.string().min(1),
  reason: z.string().min(1)
});

export const createPlanSchema = z.object({
  name: z.string().min(1, "El nombre del plan es obligatorio"),
  code: z.string().min(1, "El c\u00f3digo del plan es obligatorio").regex(/^[A-Z0-9_-]+$/, "El c\u00f3digo solo puede contener may\u00fasculas, n\u00fameros, _ y -"),
  priceUsd: z.coerce.number().min(0.01, "El precio debe ser mayor a 0"),
  lateFeeUsd: z.coerce.number().min(0, "La mora no puede ser negativa").default(10),
  graceDays: z.coerce.number().int().min(0, "Los d\u00edas de gracia no pueden ser negativos").default(30),
  description: z.string().optional()
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  priceUsd: z.coerce.number().min(0.01).optional(),
  lateFeeUsd: z.coerce.number().min(0).optional(),
  graceDays: z.coerce.number().int().min(0).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional()
}).refine(obj => Object.keys(obj).length > 0, {
  message: "Debe enviar al menos un campo para actualizar"
});

export const propagatePlanSchema = z.object({
  preview: z.boolean().default(false)
});

export const sendManualMessageSchema = z.object({
  clientId: z.string().min(1),
  subscriptionId: z.string().min(1).optional(),
  body: z.string().min(1).max(4096)
});

export const updateCronConfigSchema = z.object({
  scheduledHour: z.coerce.number().int().min(0).max(23).optional(),
  scheduledMinute: z.coerce.number().int().min(0).max(59).optional(),
  isActive: z.boolean().optional()
}).refine(obj => Object.keys(obj).length > 0, {
  message: "Debe enviar al menos un campo para actualizar"
});

/**
 * Esquema para login: requiere email y password.
 */
export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "El password debe tener al menos 6 caracteres")
});

/**
 * Esquema para registro de usuarios: requiere email, password y nombre.
 * El `role` es opcional (por defecto `"client"`).
 * Si el rol es `"client"`, se requiere `clientId`.
 */
export const registerSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "El password debe tener al menos 6 caracteres"),
  name: z.string().min(1, "El nombre es obligatorio"),
  role: z.enum(["admin", "client"]).optional(),
  clientId: z.string().min(1).optional()
}).refine(
  (data) => {
    if (data.role === "client" && !data.clientId) {
      return false;
    }
    return true;
  },
  {
    message: "Se requiere clientId para registrar un usuario con rol client",
    path: ["clientId"]
  }
);

