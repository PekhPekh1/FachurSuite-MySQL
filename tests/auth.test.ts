import { beforeAll, describe, expect, it } from "vitest";
import { signAccessToken, verifyAccessToken } from "@/lib/jwt";
import { hashPassword, verifyPassword } from "@/lib/password";

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "CUSTOMER" as const,
  customerId: "22222222-2222-4222-8222-222222222222",
  sessionVersion: 3,
};

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = "test-only-secret-with-more-than-thirty-two-characters";
});

describe("HS256 access tokens", () => {
  it("signs and verifies required claims", () => {
    const token = signAccessToken(user, Date.parse("2026-01-01T00:00:00Z"));
    const claims = verifyAccessToken(token, Date.parse("2026-01-01T00:01:00Z"));
    expect(claims?.sub).toBe(user.id);
    expect(claims?.role).toBe("CUSTOMER");
    expect(claims?.customerId).toBe(user.customerId);
    expect(claims?.sessionVersion).toBe(3);
  });

  it("rejects expired access tokens", () => {
    const issued = Date.parse("2026-01-01T00:00:00Z");
    const token = signAccessToken(user, issued);
    expect(verifyAccessToken(token, issued + 16 * 60_000)).toBeNull();
  });

  it("rejects tampered access tokens", () => {
    const token = signAccessToken(user);
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "attacker", exp: 9999999999 })).toString("base64url");
    expect(verifyAccessToken(parts.join("."))).toBeNull();
  });
});

describe("password hashing", () => {
  it("stores bcrypt hashes and rejects an incorrect password", async () => {
    const hash = await hashPassword("Stage4-test-123");
    expect(hash).not.toContain("Stage4-test-123");
    expect(hash.startsWith("$2")).toBe(true);
    expect(await verifyPassword("Stage4-test-123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
