import { describe, expect, it } from "vitest";
import { clampTtl, computeExpiry, formatMsAsTtl, formatRemaining, parseTtlMs } from "../src/core/ttl.js";
import { ConfigError } from "../src/core/errors.js";

describe("parseTtlMs", () => {
  it("parses days, hours, minutes, seconds, weeks", () => {
    expect(parseTtlMs("3d")).toBe(3 * 24 * 60 * 60 * 1000);
    expect(parseTtlMs("6h")).toBe(6 * 60 * 60 * 1000);
    expect(parseTtlMs("30m")).toBe(30 * 60 * 1000);
    expect(parseTtlMs("45s")).toBe(45 * 1000);
    expect(parseTtlMs("2w")).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  it("rejects invalid TTL strings", () => {
    expect(() => parseTtlMs("banana")).toThrow(ConfigError);
    expect(() => parseTtlMs("3")).toThrow(ConfigError);
    expect(() => parseTtlMs("-3d")).toThrow(ConfigError);
  });
});

describe("clampTtl (maximum TTL enforcement)", () => {
  it("passes through requests within the maximum", () => {
    expect(clampTtl("3d", "14d")).toEqual({ ttl: "3d", clamped: false });
  });

  it("clamps requests exceeding the maximum rather than allowing indefinite hosting", () => {
    expect(clampTtl("90d", "14d")).toEqual({ ttl: "14d", clamped: true });
  });

  it("allows a request exactly at the maximum", () => {
    expect(clampTtl("14d", "14d")).toEqual({ ttl: "14d", clamped: false });
  });
});

describe("computeExpiry", () => {
  it("adds the TTL duration to the creation time", () => {
    const created = new Date("2026-09-07T00:00:00Z");
    const expiry = computeExpiry(created, "3d");
    expect(expiry.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("formatMsAsTtl", () => {
  it("prefers the largest whole unit", () => {
    expect(formatMsAsTtl(3 * 24 * 60 * 60 * 1000)).toBe("3d");
    expect(formatMsAsTtl(90 * 60 * 1000)).toBe("90m");
  });
});

describe("formatRemaining", () => {
  it("reports expired for past timestamps", () => {
    expect(formatRemaining(new Date(Date.now() - 1000).toISOString())).toBe("expired");
  });

  it("reports days and hours remaining", () => {
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString();
    expect(formatRemaining(future)).toMatch(/2d \dh/);
  });
});
