import { randomBytes } from "node:crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Minimal ULID implementation (26-char Crockford base32: 10 time chars +
 * 16 random chars). Avoids pulling in an external dependency for a single
 * primitive. Monotonicity across the same millisecond is not guaranteed,
 * which is acceptable for deployment IDs (collision-resistant, not ordered).
 */
export function ulid(now: Date = new Date()): string {
  let time = now.getTime();
  const timeChars: string[] = [];
  for (let i = 0; i < 10; i++) {
    timeChars.unshift(CROCKFORD_ALPHABET[time % 32]);
    time = Math.floor(time / 32);
  }

  const randomBuf = randomBytes(10);
  const randomChars: string[] = [];
  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = 0;
  while (randomChars.length < 16) {
    if (bitCount < 5) {
      bitBuffer = (bitBuffer << 8) | randomBuf[byteIndex++];
      bitCount += 8;
    }
    bitCount -= 5;
    randomChars.push(CROCKFORD_ALPHABET[(bitBuffer >> bitCount) & 0x1f]);
  }

  return timeChars.join("") + randomChars.join("");
}

/** Generates the canonical deployment identifier, e.g. dep_01K5Z3Q8Y7X6QDG2QAZFN8M0R1. */
export function generateDeploymentId(now: Date = new Date()): string {
  return `dep_${ulid(now)}`;
}
