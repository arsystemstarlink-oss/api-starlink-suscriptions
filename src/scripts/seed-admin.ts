import bcrypt from "bcryptjs";
import { ensureFirebaseInitialized } from "../config/firebase.js";
import { env } from "../config/env.js";
import { UserRole } from "../domain/types.js";
import { userRepository } from "../infrastructure/firestore/repositories.js";

const ADMIN_EMAIL = "admin@starlink.com";
const ADMIN_PASSWORD = "admin123";
const ADMIN_NAME = "Administrador";

async function seedAdmin(): Promise<void> {
  ensureFirebaseInitialized();

  const existing = await userRepository.getByEmail(env.ORGANIZATION_ID, ADMIN_EMAIL);
  if (existing) {
    console.log(`El usuario ${ADMIN_EMAIL} ya existe (ID: ${existing.id})`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const admin = await userRepository.create({
    organizationId: env.ORGANIZATION_ID,
    email: ADMIN_EMAIL,
    passwordHash,
    name: ADMIN_NAME,
    role: UserRole.Admin,
    isActive: true,
  });

  console.log("Usuario admin creado exitosamente:");
  console.log(`  Email:    ${admin.email}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  ID:       ${admin.id}`);
  console.log(`  Rol:      ${admin.role}`);

  process.exit(0);
}

seedAdmin().catch((err) => {
  console.error("Error al crear el usuario admin:", err);
  process.exit(1);
});
