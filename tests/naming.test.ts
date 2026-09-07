import { describe, expect, it } from "vitest";
import { buildRepositoryName, sanitizeSlug } from "../src/core/naming.js";

describe("sanitizeSlug", () => {
  it("lowercases and replaces non-alphanumeric characters with hyphens", () => {
    expect(sanitizeSlug("design/Modern Look!")).toBe("design-modern-look");
  });

  it("collapses repeated separators and trims edges", () => {
    expect(sanitizeSlug("--weird//name--")).toBe("weird-name");
  });

  it("never returns an empty string", () => {
    expect(sanitizeSlug("///")).toBe("branch");
  });
});

describe("buildRepositoryName", () => {
  it("never uses a raw unsanitized branch name", () => {
    const name = buildRepositoryName("portfolio", "design/Modern Look!", "a83f21");
    expect(name).toBe("portfolio-design-modern-look-a83f21");
    expect(name).toMatch(/^[a-z0-9-]+$/);
  });

  it("is URL-safe and unique per suffix", () => {
    const a = buildRepositoryName("portfolio", "design/modern", "aaaaaa");
    const b = buildRepositoryName("portfolio", "design/modern", "bbbbbb");
    expect(a).not.toBe(b);
  });

  it("stays within GitHub's 100-character repository name limit", () => {
    const longRef = "design/" + "x".repeat(200);
    const name = buildRepositoryName("portfolio", longRef, "abc123");
    expect(name.length).toBeLessThanOrEqual(100);
  });

  it("avoids duplicating prefix and ref when they match", () => {
    const name = buildRepositoryName("portfolio", "portfolio", "abc123");
    expect(name).toBe("portfolio-abc123");
  });
});
