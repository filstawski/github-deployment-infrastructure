import { randomBytes } from "node:crypto";

const MAX_REPO_NAME_LENGTH = 100; // GitHub's actual limit is 100 chars.

/** Sanitizes an arbitrary branch/ref name into a URL-safe, GitHub-valid slug. */
export function sanitizeSlug(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return slug.length > 0 ? slug : "branch";
}

/** Generates a short, URL-safe, collision-resistant suffix (hex). */
export function randomSuffix(bytes = 3): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Builds a deterministic-enough, unique, URL-safe repository name from a
 * configured prefix and a source ref, per spec section 26. Never uses the
 * raw branch name unsanitized, and truncates to stay within GitHub limits.
 */
export function buildRepositoryName(prefix: string, ref: string, suffix = randomSuffix()): string {
  const prefixSlug = sanitizeSlug(prefix);
  const refSlug = sanitizeSlug(ref);
  const base = refSlug === prefixSlug || refSlug.length === 0 ? prefixSlug : `${prefixSlug}-${refSlug}`;
  const maxBaseLength = MAX_REPO_NAME_LENGTH - suffix.length - 1;
  const truncatedBase = base.length > maxBaseLength ? base.slice(0, maxBaseLength) : base;
  return `${truncatedBase}-${suffix}`;
}
