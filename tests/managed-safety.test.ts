import { describe, expect, it } from "vitest";
import { buildManagedTopics, isManagedRepository } from "../src/security/managed.js";

describe("managed repository safety markers", () => {
  it("recognizes a repository carrying the managed-by topic", () => {
    expect(isManagedRepository({ topics: buildManagedTopics() })).toBe(true);
  });

  it("refuses to treat an unmarked repository as managed", () => {
    expect(isManagedRepository({ topics: [] })).toBe(false);
  });

  it("does not trust a repository name prefix alone as proof of ownership", () => {
    // A repo could be named like a deployment repo (e.g. "portfolio-a83f21")
    // without ever having been created by this infrastructure — topics are
    // the only source of truth, never the name.
    expect(isManagedRepository({ topics: ["some-other-topic"] })).toBe(false);
  });

  it("does not treat an unrelated topic as a managed marker", () => {
    expect(isManagedRepository({ topics: ["deployment", "ephemeral"] })).toBe(false);
  });
});
