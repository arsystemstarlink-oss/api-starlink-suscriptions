import { clientRepository } from "../../infrastructure/firestore/repositories.js";
import { BusinessRuleError, NotFoundError } from "../../domain/errors.js";
import type { Client, RequestContext, PaginationParams, PaginatedResult } from "../../domain/models.js";
import { activityLogService } from "../audit/activityLogService.js";

const filterUndefined = (obj: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

export const clientService = {
  async create(input: {
    context: RequestContext;
    name: string;
    dni: string;
    phone: string;
    address: string;
  }) {
    const existing = await clientRepository.getByPhone(input.context.organizationId, input.phone);

    if (existing) {
      throw new BusinessRuleError("Ya existe un cliente con ese teléfono");
    }

    const existingByDni = await clientRepository.getByDni(input.context.organizationId, input.dni);

    if (existingByDni) {
      throw new BusinessRuleError("Ya existe un cliente con ese DNI");
    }

    const client = await clientRepository.create({
      organizationId: input.context.organizationId,
      name: input.name,
      dni: input.dni,
      phone: input.phone,
      address: input.address
    });

    await activityLogService.log({
      context: input.context,
      action: "client.created",
      entityType: "client",
      entityId: client.id,
      after: filterUndefined(client as unknown as Record<string, unknown>)
    });

    return client;
  },

  async getById(context: RequestContext, id: string): Promise<Client> {
    const client = await clientRepository.getById(context.organizationId, id);

    if (!client) {
      throw new NotFoundError(`Cliente no encontrado (id: ${id})`);
    }

    return client;
  },

  async list(context: RequestContext, pagination?: PaginationParams): Promise<PaginatedResult<Client>> {
    return await clientRepository.list(context.organizationId, pagination);
  },

  async update(context: RequestContext, id: string, data: Partial<Pick<Client, "name" | "dni" | "phone" | "address">>): Promise<Client> {
    const client = await this.getById(context, id);
    const before = { ...client };

    if (data.phone && data.phone !== client.phone) {
      const existingPhone = await clientRepository.getByPhone(context.organizationId, data.phone);
      if (existingPhone) {
        throw new BusinessRuleError("Ya existe un cliente con ese teléfono");
      }
    }

    if (data.dni && data.dni !== client.dni) {
      const existingByDni = await clientRepository.getByDni(context.organizationId, data.dni);
      if (existingByDni) {
        throw new BusinessRuleError("Ya existe un cliente con ese DNI");
      }
    }

    const updatedData: Partial<Client> = {};
    if (data.name !== undefined) updatedData.name = data.name;
    if (data.phone !== undefined) updatedData.phone = data.phone;
    if (data.address !== undefined) updatedData.address = data.address;
    if (data.dni !== undefined) updatedData.dni = data.dni;

    await clientRepository.update(id, context.organizationId, updatedData);

    const updated = await this.getById(context, id);

    await activityLogService.log({
      context,
      action: "client.updated",
      entityType: "client",
      entityId: id,
      before: filterUndefined(before as unknown as Record<string, unknown>),
      after: filterUndefined(updated as unknown as Record<string, unknown>)
    });

    return updated;
  },

  async delete(context: RequestContext, id: string): Promise<void> {
    await clientRepository.delete(id, context.organizationId);
    await activityLogService.log({
      context,
      action: "client.deleted",
      entityType: "client",
      entityId: id,
      before: { id }
    });
  }
};
