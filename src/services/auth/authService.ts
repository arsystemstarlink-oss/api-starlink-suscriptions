import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { userRepository } from "../../infrastructure/firestore/repositories.js";
import { env, jwtExpiresInSeconds } from "../../config/env.js";
import { UserRole } from "../../domain/types.js";
import { BusinessRuleError, UnauthorizedError, NotFoundError } from "../../domain/errors.js";
import type { User, UserPublic, RequestContext } from "../../domain/models.js";

const BCRYPT_ROUNDS = 10;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Payload que se incluye dentro del JWT emitido por el sistema.
 *
 * - `sub`: ID del usuario (subject).
 * - `email`: email del usuario (para referencia rápida sin decodificar desde DB).
 * - `role`: rol del usuario (`admin` o `client`).
 * - `clientId`: para usuarios con rol `client`, referencia al Client de negocio.
 * - `organizationId`: organización a la que pertenece el usuario.
 * - `iat` / `exp`: timestamps de emisión y expiración (agregados por `jsonwebtoken`).
 */
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  clientId?: string;
  organizationId: string;
  iat?: number;
  exp?: number;
}

export interface LoginResult {
  token: string;
  user: UserPublic;
  expiresIn: number;
}

export interface RegisterResult {
  user: UserPublic;
}

/**
 * Devuelve el payload JWT con los datos mínimos necesarios del usuario.
 * @param user - Usuario autenticado.
 * @returns Payload para firmar con `jsonwebtoken.sign()`.
 */
export function buildJwtPayload(user: User): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    clientId: user.clientId,
    organizationId: user.organizationId
  };
}

/**
 * Hashea un password en plaintext usando bcrypt.
 * @param password - Password a hashear.
 * @returns Hash bcrypt resultante.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Compara un password en plaintext con un hash bcrypt.
 * @param password - Password a verificar.
 * @param hash - Hash almacenado.
 * @returns `true` si coinciden.
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const authService = {
  /**
   * Registra un nuevo usuario en el sistema.
   *
   * - Valida que el email tenga formato válido y no esté repetido en la organización.
   * - El password se hashea con bcrypt antes de almacenarse.
   * - Devuelve el usuario sin `passwordHash`.
   * - Si el rol es `client`, debe proporcionarse `clientId` válido.
   *
   * @throws {@link BusinessRuleError} si el email ya existe, el formato es inválido,
   * o si el rol es `client` pero no se proporciona `clientId`.
   */
  async register(input: {
    context: RequestContext;
    email: string;
    password: string;
    name: string;
    role?: UserRole;
    clientId?: string;
  }): Promise<RegisterResult> {
    const { email, password, name, role = UserRole.Client, clientId } = input;

    if (!EMAIL_REGEX.test(email)) {
      throw new BusinessRuleError("Email inválido");
    }

    if (password.length < 6) {
      throw new BusinessRuleError("El password debe tener al menos 6 caracteres");
    }

    if (role === UserRole.Client && !clientId) {
      throw new BusinessRuleError("Se requiere clientId para registrar un usuario con rol client");
    }

    const existing = await userRepository.getByEmail(input.context.organizationId, email);
    if (existing) {
      throw new BusinessRuleError("Ya existe un usuario con ese email");
    }

    const passwordHash = await hashPassword(password);

    const user = await userRepository.create({
      organizationId: input.context.organizationId,
      email,
      passwordHash,
      name,
      role,
      clientId: role === UserRole.Client ? clientId : undefined,
      isActive: true
    });

    const { passwordHash: _, ...userPublic } = user;
    return { user: userPublic };
  },

  /**
   * Verifica las credenciales de un usuario y emite un JWT.
   *
   * Flujo:
   * 1. Busca el usuario por email.
   * 2. Verifica que el password coincida.
   * 3. Verifica que el usuario esté activo.
   * 4. Firma un JWT con el payload ({@link JwtPayload}).
   *
   * @throws {@link UnauthorizedError} si las credenciales son inválidas o el usuario está inactivo.
   */
  async login(input: {
    context: RequestContext;
    email: string;
    password: string;
  }): Promise<LoginResult> {
    const user = await userRepository.getByEmail(input.context.organizationId, input.email);

    if (!user) {
      throw new UnauthorizedError("Credenciales inválidas");
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError("Credenciales inválidas");
    }

    if (!user.isActive) {
      throw new UnauthorizedError("El usuario está inactivo");
    }

    const payload = buildJwtPayload(user);
    const token = jwt.sign(payload, env.JWT_SECRET, {
      expiresIn: jwtExpiresInSeconds
    });

    const { passwordHash: _, ...userPublic } = user;

    return {
      token,
      user: userPublic,
      expiresIn: jwtExpiresInSeconds
    };
  },

  /**
   * Verifica y decodifica un token JWT.
   *
   * @param token - Token completo (sin el prefijo `"Bearer "`).
   * @returns El payload decodificado si es válido.
   * @throws {@link UnauthorizedError} si el token es inválido, expiró o fue manipulado.
   */
  verifyToken(token: string): JwtPayload {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      return payload;
    } catch {
      throw new UnauthorizedError("Token inválido o expirado");
    }
  },

  /**
   * Busca el usuario asociado a un token JWT y lo devuelve sin `passwordHash`.
   *
   * @throws {@link UnauthorizedError} si el token no corresponde a un usuario existente.
   */
  async getUserFromToken(token: string): Promise<UserPublic> {
    const payload = this.verifyToken(token);
    const user = await userRepository.getById(payload.organizationId, payload.sub);

    if (!user) {
      throw new UnauthorizedError("Usuario no encontrado");
    }

    const { passwordHash: _, ...userPublic } = user;
    return userPublic;
  },

  /**
   * Desactiva un usuario sin eliminarlo. Un usuario inactivo no podrá hacer login.
   *
   * @throws {@link NotFoundError} si el usuario no existe.
   *
   * @throws {@link BusinessRuleError} si intenta desactivarse a sí mismo siendo el último admin activo.
   */
  async deactivate(context: RequestContext, userId: string): Promise<void> {
    const user = await userRepository.getById(context.organizationId, userId);
    if (!user) {
      throw new NotFoundError(`Usuario no encontrado (id: ${userId})`);
    }
    await userRepository.update(userId, context.organizationId, { isActive: false });
  },

  /**
   * Activa un usuario previamente desactivado.
   */
  async activate(context: RequestContext, userId: string): Promise<void> {
    const user = await userRepository.getById(context.organizationId, userId);
    if (!user) {
      throw new NotFoundError(`Usuario no encontrado (id: ${userId})`);
    }
    await userRepository.update(userId, context.organizationId, { isActive: true });
  },

  /**
   * Lista todos los usuarios de la organización sin `passwordHash`.
   */
  async listUsers(context: RequestContext): Promise<UserPublic[]> {
    const users = await userRepository.list(context.organizationId);
    return users.map(({ passwordHash, ...rest }) => rest);
  }
};
