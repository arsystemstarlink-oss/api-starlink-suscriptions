import { getFirestore as getAdminFirestore, type Firestore, type DocumentData } from "firebase-admin/firestore";

let instance: Firestore | null = null;

export function getFirestore(): Firestore {
  if (!instance) {
    instance = getAdminFirestore();
  }
  return instance;
}

export function resetFirestore() {
  instance = null;
}

export function sanitizeForFirestore<T extends Record<string, any>>(data: T): Record<string, any> {
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}
