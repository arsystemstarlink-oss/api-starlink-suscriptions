import { daysUntilNextCutoff, daysBetweenInclusive, addDays, addMonthsPreservingDay, nextCutoffDate, toDateString, toLocalDate } from "../domain/dateUtils.js";

describe("dateUtils", () => {
  describe("toDateString", () => {
    it("from local date string", () => {
      expect(toDateString("2026-05-05")).toBe("2026-05-05");
    });

    it("from Date object (local midnight)", () => {
      const date = toLocalDate("2026-05-05");
      expect(toDateString(date)).toBe("2026-05-05");
    });
  });

  describe("addDays", () => {
    it("adds days to a date", () => {
      const result = addDays("2026-05-05", 10);
      expect(toDateString(result)).toBe("2026-05-15");
    });
  });

  describe("addMonthsPreservingDay", () => {
    it("adds 1 month preserving day", () => {
      const result = addMonthsPreservingDay(toLocalDate("2026-05-05"), 1);
      expect(toDateString(result)).toBe("2026-06-05");
    });
  });

  describe("nextCutoffDate", () => {
    it("returns the next date matching dueDay when it is still in the future", () => {
      const result = nextCutoffDate(toLocalDate("2026-05-01"), 5);
      expect(toDateString(result)).toBe("2026-05-05");
    });

    it("advances to next month when dueDay has passed", () => {
      const result = nextCutoffDate(toLocalDate("2026-05-10"), 5);
      expect(toDateString(result)).toBe("2026-06-05");
    });

    it("advances to next month when on the same due day", () => {
      const result = nextCutoffDate(toLocalDate("2026-05-05"), 5);
      expect(toDateString(result)).toBe("2026-06-05");
    });
  });

  describe("daysBetweenInclusive", () => {
    it("returns 1 for the same day", () => {
      expect(daysBetweenInclusive("2026-05-05", "2026-05-05")).toBe(1);
    });

    it("counts correctly for a 10 day span", () => {
      expect(daysBetweenInclusive("2026-05-01", "2026-05-10")).toBe(10);
    });
  });

  describe("daysUntilNextCutoff", () => {
    it("returns remaining days (exclusive of payment day)", () => {
      const result = daysUntilNextCutoff(toLocalDate("2026-06-25"), 5);
      expect(result).toBe(10);
    });
  });
});
