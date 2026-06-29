import "dotenv/config";
import { z } from "zod";

const JWT_EXPIRES_IN_SECONDS: Record<string, number> = {
  "1h": 3600,
  "12h": 43200,
  "24h": 86400,
  "7d": 604800
};

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ORGANIZATION_ID: z.string().min(1).default("default"),
  TIMEZONE: z.string().min(1).default("America/Caracas"),
  DEFAULT_ADMIN_ID: z.string().min(1).default("local-admin"),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_KEY_PATH: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  TWILIO_WHATSAPP_TO: z.string().optional(),
  TWILIO_WHATSAPP_REMINDER_SID: z.string(),
  TWILIO_WHATSAPP_CUTOFF_SID: z.string(),
  TWILIO_WHATSAPP_SUSPENDED_SID: z.string(),
  TWILIO_WEBHOOK_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.enum(["1h", "12h", "24h", "7d"]).default("24h")
});

export const env = envSchema.parse(process.env);

export const jwtExpiresInSeconds = JWT_EXPIRES_IN_SECONDS[env.JWT_EXPIRES_IN] ?? 86400;
