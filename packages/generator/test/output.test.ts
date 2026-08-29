import { describe, expect, it } from "vitest";
import { shouldUpdateLatest } from "../src/output/write-json.js";
import type { TrendIndex } from "../src/types.js";

const index: TrendIndex = {
  schemaVersion: "daily-tech-radar.index.v1",
  source: "github",
  locale: "en-US",
  latestDate: "2026-08-28",
  dates: ["2026-08-27", "2026-08-28"],
  generatedAt: "2026-08-29T00:00:00.000Z"
};

describe("daily output", () => {
  it("updates latest for the newest date", () => {
    expect(shouldUpdateLatest(index, "2026-08-28")).toBe(true);
  });

  it("preserves latest while backfilling an older date", () => {
    expect(shouldUpdateLatest(index, "2026-08-27")).toBe(false);
  });
});
