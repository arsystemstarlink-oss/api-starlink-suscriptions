import jwt from "jsonwebtoken";
import { UserRole } from "../../domain/types.js";
import { store } from "./mockRepositories.js";

const JWT_SECRET = process.env.JWT_SECRET || "starlink-api-dev-secret-key-change-in-prod-2026";

export { store };

export function resetStore() {
  store.reset();
}

export function makeAdminToken(organizationId = "test-org", userId = "admin-1") {
  return jwt.sign(
    { sub: userId, email: "admin@test.com", role: UserRole.Admin, organizationId },
    JWT_SECRET,
    { expiresIn: 3600 }
  );
}

export function makeClientToken(
  organizationId = "test-org",
  userId = "client-1",
  clientId = "client-id-1"
) {
  return jwt.sign(
    { sub: userId, email: "client@test.com", role: UserRole.Client, clientId, organizationId },
    JWT_SECRET,
    { expiresIn: 3600 }
  );
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}
