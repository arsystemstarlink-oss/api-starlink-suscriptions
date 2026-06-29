import { schedule, type ScheduledTask } from "node-cron";
import { cronConfigRepository } from "../../infrastructure/firestore/repositories.js";
import { dailyJobService } from "./dailyJobService.js";
import { env } from "../../config/env.js";
import { UserRole } from "../../domain/types.js";
import type { CronScheduleConfig, RequestContext } from "../../domain/models.js";

/** Horario por defecto si no hay configuración guardada en Firestore. */
const DEFAULT_HOUR = 8;
const DEFAULT_MINUTE = 0;

function buildDefaultConfig(organizationId: string): CronScheduleConfig {
  return {
    id: "daily",
    organizationId,
    scheduledHour: DEFAULT_HOUR,
    scheduledMinute: DEFAULT_MINUTE,
    isActive: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Genera una expresión cron a partir de hora y minuto en formato 24h.
 * @param hour - Hora del día (0–23, formato 24).
 * @param minute - Minuto de la hora (0–59).
 * @returns Expresión cron válida para node-cron (p.ej. `"0 8 * * *"`).
 */
export function buildCronExpression(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

/**
 * Formatea la hora programada como string `"HH:MM"` (formato 24h).
 * @param hour - Hora (0–23).
 * @param minute - Minuto (0–59).
 * @returns String `"HH:MM"` siempre de 5 caracteres (p.ej. `"08:00"`, `"23:45"`).
 */
export function formatScheduledTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Gestiona el cron automático del job diario.
 *
 * Lee la configuración de Firestore al arrancar y programa (o no) la ejecución
 * automática según `isActive`, `scheduledHour` y `scheduledMinute`.
 *
 * - Si se actualiza la config vía `updateConfig`, re-programa inmediatamente.
 * - Si se desactiva, detiene el job sin perder la configuración.
 * - Registra el resultado de cada ejecución en Firestore como `lastRunAt` / `lastRunResult`.
 */
class SchedulerService {
  private task: ScheduledTask | null = null;
  private currentConfig: CronScheduleConfig | null = null;

  /**
   * Lee la configuración desde Firestore y programa el cron si `isActive === true`.
   * Si no existe configuración, queda inactivo hasta que se configure vía API.
   */
  async initialize(): Promise<void> {
    const config = await cronConfigRepository.get(env.ORGANIZATION_ID);

    if (!config) {
      console.log("⏰ Cron: sin configuración. Ejecución automática desactivada.");
      this.currentConfig = buildDefaultConfig(env.ORGANIZATION_ID);
      return;
    }

    this.currentConfig = config;

    if (config.isActive) {
      this.schedule(config);
    } else {
      console.log("⏰ Cron: inactivo. Ejecución automática desactivada.");
    }
  }

  /**
   * Programa/re-programa el cron con la configuración dada.
   * Detiene cualquier tarea previa antes de crear la nueva.
   * @param config - Configuración de cron con hora (24h), minuto y zona horaria del env.
   */
  private schedule(config: CronScheduleConfig): void {
    this.stop();

    const expression = buildCronExpression(config.scheduledHour, config.scheduledMinute);
    const timezone = env.TIMEZONE;

    this.task = schedule(expression, () => {
      this.executeDailyJob();
    }, {
      timezone
    });

    console.log(`⏰ Cron programado: ${expression} (tz: ${timezone})`);
  }

  /**
   * Ejecuta el job diario y persiste el resultado en Firestore.
   * No lanza errores: captura y registra para no romper el scheduler.
   */
  private async executeDailyJob(): Promise<void> {
    const context: RequestContext = {
      organizationId: env.ORGANIZATION_ID,
      userId: "cron-scheduler",
      role: UserRole.Admin
    };

    console.log("⏰ Ejecutando cron diario automático...");

    try {
      const result = await dailyJobService.run(context);
      await cronConfigRepository.updateLastRun(
        context.organizationId,
        result.status,
        result.errors.length > 0 ? result.errors.join("; ") : undefined
      );
      console.log(
        `⏰ Cron diario completado: ${result.status} — ${result.reminded} recordatorios, ${result.suspended} suspensiones`
      );
      if (result.errors.length > 0) {
        console.warn("⏰ Errores:", result.errors);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      await cronConfigRepository.updateLastRun(context.organizationId, "failed", message);
      console.error("⏰ Error en cron diario:", message);
    }
  }

  /** Detiene la tarea programada si existe. */
  private stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  /** Obtiene la configuración actual de cron desde Firestore. */
  async getConfig(): Promise<CronScheduleConfig | null> {
    return cronConfigRepository.get(env.ORGANIZATION_ID);
  }

  /**
   * Actualiza la configuración de cron: hora, minuto y/o estado activo.
   * Si `isActive` es `true` y no existen `scheduledHour`/`scheduledMinute` previos,
   * usa valores por defecto (08:00) para evitar dejar el cron huérfano.
   *
   * @param updates - Campos parciales a actualizar (`scheduledHour`, `scheduledMinute`, `isActive`).
   * @returns La configuración resultante tras aplicar los cambios.
   */
  async updateConfig(
    updates: Partial<{ scheduledHour: number; scheduledMinute: number; isActive: boolean }>
  ): Promise<CronScheduleConfig> {
    const current = await cronConfigRepository.get(env.ORGANIZATION_ID);

    const newHour = updates.scheduledHour ?? current?.scheduledHour ?? DEFAULT_HOUR;
    const newMinute = updates.scheduledMinute ?? current?.scheduledMinute ?? DEFAULT_MINUTE;
    const newActive = updates.isActive ?? current?.isActive ?? false;

    const config = await cronConfigRepository.upsert(env.ORGANIZATION_ID, {
      scheduledHour: newHour,
      scheduledMinute: newMinute,
      isActive: newActive
    });

    this.currentConfig = config;

    if (config.isActive) {
      this.schedule(config);
    } else {
      this.stop();
      console.log("⏰ Cron desactivado.");
    }

    return config;
  }

  /**
   * Obtiene el estado actual del scheduler sin consultar Firestore (usa config en memoria).
   * Siempre devuelve valores por defecto si no hay configuración activa.
   * @returns Objeto con `isRunning`, `config`, `scheduledTime` (formato `"HH:MM"` 24h) y `timezone`.
   */
  getStatus() {
    const config = this.currentConfig ?? buildDefaultConfig(env.ORGANIZATION_ID);

    return {
      isRunning: this.task !== null,
      config,
      scheduledTime: formatScheduledTime(config.scheduledHour, config.scheduledMinute),
      timezone: env.TIMEZONE
    };
  }

  /** Detiene el cron. Llamar al apagar el servidor (SIGINT/SIGTERM). */
  shutdown(): void {
    this.stop();
  }
}

export const schedulerService = new SchedulerService();
