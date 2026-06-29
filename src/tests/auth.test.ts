import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { hashPassword, verifyPassword, buildJwtPayload } from "../services/auth/authService.js";
import { extractBearerToken } from "../api/middlewares/authMiddleware.js";
import { loginSchema, registerSchema } from "../api/validators/schemas.js";
import { env } from "../config/env.js";
import { UserRole } from "../domain/types.js";

describe("auth", () => {
  describe("hashPassword / verifyPassword", () => {
    it("hashes password and verifies it", async () => {
      const hash = await hashPassword("test123");
      expect(await verifyPassword("test123", hash)).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = await hashPassword("correct-password");
      expect(await verifyPassword("wrong-password", hash)).toBe(false);
    });

    it("produces different hashes for same input (salt)", async () => {
      const hash1 = await hashPassword("same");
      const hash2 = await hashPassword("same");
      expect(hash1).not.toBe(hash2);
      expect(await verifyPassword("same", hash1)).toBe(true);
      expect(await verifyPassword("same", hash2)).toBe(true);
    });
  });

  describe("buildJwtPayload", () => {
    it("extracts required fields from User", () => {
      const payload = buildJwtPayload({
        id: "user-1",
        organizationId: "org-1",
        email: "test@example.com",
        name: "Test User",
        role: UserRole.Admin,
        passwordHash: "hash",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });

      expect(payload).toEqual({
        sub: "user-1",
        email: "test@example.com",
        role: UserRole.Admin,
        organizationId: "org-1"
      });
    });

    it("does NOT include passwordHash", () => {
      const payload = buildJwtPayload({
        id: "user-2",
        organizationId: "org-1",
        email: "test@example.com",
        name: "Test",
        role: UserRole.Client,
        passwordHash: "should-not-leak",
        isActive: true,
        createdAt: "",
        updatedAt: ""
      });

      expect(payload).not.toHaveProperty("passwordHash");
    });
  });

  describe("verifyToken (round-trip)", () => {
    it("signs and verifies a token with JWT_SECRET", () => {
      const payload = {
        sub: "user-1",
        email: "a@b.com",
        role: UserRole.Admin as const,
        organizationId: "org-1"
      };

      const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: 3600 });
      const decoded = jwt.verify(token, env.JWT_SECRET) as any;

      expect(decoded.sub).toBe("user-1");
      expect(decoded.email).toBe("a@b.com");
      expect(decoded.role).toBe("admin");
      expect(decoded.organizationId).toBe("org-1");
      expect(decoded.exp - decoded.iat).toBe(3600);
    });

    it("rejects tokens signed with wrong secret", () => {
      const token = jwt.sign({ sub: "user-1" }, "wrong-secret-that-is-long-enough");
      expect(() => jwt.verify(token, env.JWT_SECRET)).toThrow();
    });

    it("rejects expired tokens", () => {
      const token = jwt.sign(
        { sub: "user-1" },
        env.JWT_SECRET,
        { expiresIn: -10 }
      );
      expect(() => jwt.verify(token, env.JWT_SECRET)).toThrow();
    });

    it("rejects malformed tokens", () => {
      expect(() => jwt.verify("not.a.token", env.JWT_SECRET)).toThrow();
      expect(() => jwt.verify("", env.JWT_SECRET)).toThrow();
    });
  });

  describe("extractBearerToken", () => {
    it("extracts token from Bearer header", () => {
      const req = { headers: { authorization: "Bearer abc123" } } as any;
      expect(extractBearerToken(req)).toBe("abc123");
    });

    it("returns null when header is missing", () => {
      const req = { headers: {} } as any;
      expect(extractBearerToken(req)).toBeNull();
    });

    it("returns null for non-Bearer auth", () => {
      const req = { headers: { authorization: "Basic abc123" } } as any;
      expect(extractBearerToken(req)).toBeNull();
    });

    it("trims whitespace around token", () => {
      const req = { headers: { authorization: "Bearer   token-with-spaces  " } } as any;
      expect(extractBearerToken(req)).toBe("token-with-spaces");
    });

    it("returns null for empty Bearer", () => {
      const req = { headers: { authorization: "Bearer " } } as any;
      expect(extractBearerToken(req)).toBeNull();
    });
  });

  describe("loginSchema", () => {
    it("accepts valid login", () => {
      expect(loginSchema.safeParse({ email: "test@example.com", password: "123456" }).success).toBe(true);
    });

    it("rejects invalid email", () => {
      expect(loginSchema.safeParse({ email: "not-an-email", password: "123456" }).success).toBe(false);
    });

    it("requires password of at least 6 chars", () => {
      expect(loginSchema.safeParse({ email: "a@b.com", password: "123" }).success).toBe(false);
      expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    });

    it("requires both fields", () => {
      expect(loginSchema.safeParse({ email: "a@b.com" }).success).toBe(false);
      expect(loginSchema.safeParse({ password: "123456" }).success).toBe(false);
    });
  });

  describe("registerSchema", () => {
    it("accepts valid registration", () => {
      const result = registerSchema.safeParse({
        email: "a@b.com",
        password: "123456",
        name: "Juan"
      });
      expect(result.success).toBe(true);
    });

    it("accepts registration with role", () => {
      const withAdmin = registerSchema.safeParse({
        email: "a@b.com",
        password: "123456",
        name: "Admin",
        role: "admin"
      });
      expect(withAdmin.success).toBe(true);

      const withClient = registerSchema.safeParse({
        email: "a@b.com",
        password: "123456",
        name: "Client User",
        role: "client",
        clientId: "client-123"
      });
      expect(withClient.success).toBe(true);
    });

    it("rejects invalid role value", () => {
      const result = registerSchema.safeParse({
        email: "a@b.com",
        password: "123456",
        name: "Test",
        role: "superadmin"
      });
      expect(result.success).toBe(false);
    });

    it("requires name", () => {
      const result = registerSchema.safeParse({
        email: "a@b.com",
        password: "123456"
      });
      expect(result.success).toBe(false);
    });
  });
});
