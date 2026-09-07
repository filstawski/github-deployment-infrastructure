import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "../src/health/healthcheck.js";
import type { HealthcheckConfig } from "../src/core/types.js";

const baseConfig: HealthcheckConfig = {
  path: "/",
  timeoutMs: 50,
  retries: 3,
  retryDelayMs: 1,
  expectedStatus: [200],
};

describe("checkHealth", () => {
  it("succeeds immediately on the first healthy response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await checkHealth("https://example.github.io/repo/", baseConfig, fetchMock as any);
    expect(result.healthy).toBe(true);
    expect(result.attempts).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on failure and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const result = await checkHealth("https://example.github.io/repo/", baseConfig, fetchMock as any);
    expect(result.healthy).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("exhausts retries and reports failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await checkHealth("https://example.github.io/repo/", baseConfig, fetchMock as any);
    expect(result.healthy).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.error).toMatch(/500/);
  });

  it("honors a custom set of expected status codes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 301 }));
    const result = await checkHealth("https://example.github.io/repo/", { ...baseConfig, expectedStatus: [200, 301] }, fetchMock as any);
    expect(result.healthy).toBe(true);
  });

  it("resolves the healthcheck path against the base URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    await checkHealth("https://example.github.io/repo/", { ...baseConfig, path: "/status" }, fetchMock as any);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.github.io/repo/status");
  });
});
