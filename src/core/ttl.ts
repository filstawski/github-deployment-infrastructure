import { ConfigError } from "./errors.js";

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const TTL_PATTERN = /^(\d+)\s*(s|m|h|d|w)$/i;

/** Parses strings like "3d", "6h", "90d" into milliseconds. */
export function parseTtlMs(ttl: string): number {
  const match = TTL_PATTERN.exec(ttl.trim());
  if (!match) {
    throw new ConfigError(`Invalid TTL/duration value: "${ttl}"`, {
      suggestedAction: 'Use a value like "3d", "6h", "30m", or "90s".',
    });
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * UNIT_MS[unit];
}

export function formatMsAsTtl(ms: number): string {
  const days = ms / UNIT_MS.d;
  if (Number.isInteger(days) && days > 0) return `${days}d`;
  const hours = ms / UNIT_MS.h;
  if (Number.isInteger(hours) && hours > 0) return `${hours}h`;
  const minutes = ms / UNIT_MS.m;
  if (Number.isInteger(minutes) && minutes > 0) return `${minutes}m`;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * Clamps a requested TTL to the configured maximum. Never silently allows
 * unbounded/indefinite hosting (spec section 18).
 */
export function clampTtl(requestedTtl: string, maximumTtl: string): { ttl: string; clamped: boolean } {
  const requestedMs = parseTtlMs(requestedTtl);
  const maxMs = parseTtlMs(maximumTtl);
  if (requestedMs > maxMs) {
    return { ttl: maximumTtl, clamped: true };
  }
  return { ttl: requestedTtl, clamped: false };
}

export function computeExpiry(createdAt: Date, ttl: string): Date {
  return new Date(createdAt.getTime() + parseTtlMs(ttl));
}

export function formatRemaining(expiresAt: string, now: Date = new Date()): string {
  const diffMs = new Date(expiresAt).getTime() - now.getTime();
  if (diffMs <= 0) return "expired";
  const days = Math.floor(diffMs / UNIT_MS.d);
  const hours = Math.floor((diffMs % UNIT_MS.d) / UNIT_MS.h);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((diffMs % UNIT_MS.h) / UNIT_MS.m);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
