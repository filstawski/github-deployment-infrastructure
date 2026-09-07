import type { HealthResult, HealthcheckConfig } from "../core/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a URL until it returns an expected status code or retries are
 * exhausted. Deployment success must mean this succeeded, not merely that
 * an API call succeeded (spec section 22 / principle 7).
 */
export async function checkHealth(
  url: string,
  config: HealthcheckConfig,
  fetchImpl: typeof fetch = fetch
): Promise<HealthResult> {
  // GitHub Pages project sites live under https://OWNER.github.io/REPO/, so a
  // configured healthcheck path (e.g. "/status") must resolve relative to
  // that base path, not the domain root (spec section 13).
  const base = url.endsWith("/") ? url : `${url}/`;
  const relativePath = config.path.replace(/^\/+/, "");
  const target = new URL(relativePath, base).toString();
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= config.retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await fetchImpl(target, { signal: controller.signal, redirect: "follow" });
        lastStatus = response.status;
        if (config.expectedStatus.includes(response.status)) {
          return { healthy: true, statusCode: response.status, attempts: attempt, url: target };
        }
        lastError = `Unexpected status code: ${response.status}`;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt < config.retries) {
      await sleep(config.retryDelayMs);
    }
  }

  return {
    healthy: false,
    statusCode: lastStatus,
    attempts: config.retries,
    error: lastError,
    url: target,
  };
}
