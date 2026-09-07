import { describe, expect, it } from "vitest";
import { generateDeploymentId, ulid } from "../src/core/id.js";

describe("generateDeploymentId", () => {
  it("uses the dep_ prefix and a 26-character ULID", () => {
    const id = generateDeploymentId();
    expect(id).toMatch(/^dep_[0-9A-Z]{26}$/);
  });

  it("generates collision-resistant IDs across many calls", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateDeploymentId()));
    expect(ids.size).toBe(1000);
  });
});

describe("ulid", () => {
  it("is time-sortable at the millisecond boundary", () => {
    const earlier = ulid(new Date("2026-01-01T00:00:00.000Z"));
    const later = ulid(new Date("2026-01-01T00:00:01.000Z"));
    expect(earlier.slice(0, 10) < later.slice(0, 10)).toBe(true);
  });
});
