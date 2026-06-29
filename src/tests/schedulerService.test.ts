import { buildCronExpression, formatScheduledTime } from "../services/cron/schedulerService.js";
import { updateCronConfigSchema } from "../api/validators/schemas.js";

describe("scheduler – pure functions", () => {
  describe("formatScheduledTime", () => {
    it("formats midnight as 00:00", () => {
      expect(formatScheduledTime(0, 0)).toBe("00:00");
    });

    it("pads single-digit hour and minute", () => {
      expect(formatScheduledTime(8, 5)).toBe("08:05");
    });

    it("formats max time as 23:59", () => {
      expect(formatScheduledTime(23, 59)).toBe("23:59");
    });

    it("always returns 5 characters (HH:MM)", () => {
      expect(formatScheduledTime(0, 0)).toHaveLength(5);
      expect(formatScheduledTime(9, 9)).toHaveLength(5);
      expect(formatScheduledTime(15, 30)).toHaveLength(5);
    });

    it("uses 24h format, no AM/PM", () => {
      const result = formatScheduledTime(14, 30);
      expect(result).toBe("14:30");
      expect(result).not.toContain("PM");
      expect(result).not.toContain("pm");
    });
  });

  describe("buildCronExpression", () => {
    it("generates valid cron for 08:00", () => {
      expect(buildCronExpression(8, 0)).toBe("0 8 * * *");
    });

    it("generates valid cron for 23:45", () => {
      expect(buildCronExpression(23, 45)).toBe("45 23 * * *");
    });

    it("generates valid cron for 00:00 (midnight)", () => {
      expect(buildCronExpression(0, 0)).toBe("0 0 * * *");
    });

    it("puts minute before hour (standard cron)", () => {
      const expression = buildCronExpression(15, 30);
      const parts = expression.split(" ");
      expect(parts[0]).toBe("30");
      expect(parts[1]).toBe("15");
      expect(parts[2]).toBe("*");
      expect(parts[3]).toBe("*");
      expect(parts[4]).toBe("*");
    });
  });

  describe("updateCronConfigSchema (24h format)", () => {
    it("accepts hour 0 (midnight)", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledHour: 0 }).success).toBe(true);
    });

    it("accepts hour 23 (max valid)", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledHour: 23 }).success).toBe(true);
    });

    it("rejects hour 24 (out of 24h range)", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledHour: 24 }).success).toBe(false);
    });

    it("rejects negative hour", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledHour: -1 }).success).toBe(false);
    });

    it("accepts minute 0–59", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledMinute: 0 }).success).toBe(true);
      expect(updateCronConfigSchema.safeParse({ scheduledMinute: 59 }).success).toBe(true);
    });

    it("rejects minute 60", () => {
      expect(updateCronConfigSchema.safeParse({ scheduledMinute: 60 }).success).toBe(false);
    });

    it("rejects empty body", () => {
      expect(updateCronConfigSchema.safeParse({}).success).toBe(false);
    });

    it("accepts only isActive without time fields", () => {
      expect(updateCronConfigSchema.safeParse({ isActive: true }).success).toBe(true);
    });
  });
});
