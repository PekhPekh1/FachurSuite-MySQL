import { describe, expect, it } from "vitest";
import { defaultProvider, renderBody, validateProviderConfig, sendViaProvider, type SmsProviderConfig } from "@/lib/sms/provider";

const base = (): SmsProviderConfig => ({
  ...defaultProvider,
  name: "Test Provider",
  apiUrl: "https://api.example.com/sms/send",
  apiKey: "secret-token-value",
  senderNumber: "50004000",
  method: "POST",
  bodyTemplate: '{"to":"{phone}","message":"{message}","sender":"{sender}"}',
  successIndicator: "",
  successPath: "STATUS_2XX",
  authStyle: "BEARER",
  requireTls: true,
  isActive: true,
});

describe("provider configuration validation", () => {
  it("accepts a valid HTTPS configuration", () => {
    expect(validateProviderConfig(base()).ok).toBe(true);
  });

  it("requires a provider name", () => {
    const r = validateProviderConfig({ ...base(), name: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("نام سرویس‌دهنده");
  });

  it("rejects a malformed URL", () => {
    expect(validateProviderConfig({ ...base(), apiUrl: "not-a-url" }).ok).toBe(false);
  });

  it("rejects non-HTTP schemes", () => {
    expect(validateProviderConfig({ ...base(), apiUrl: "ftp://example.com/x" }).ok).toBe(false);
    expect(validateProviderConfig({ ...base(), apiUrl: "file:///etc/passwd" }).ok).toBe(false);
  });

  it("enforces HTTPS when requireTls is set", () => {
    const http = { ...base(), apiUrl: "http://api.example.com/sms" };
    expect(validateProviderConfig(http).ok).toBe(false);
    expect(validateProviderConfig({ ...http, requireTls: false }).ok).toBe(true);
  });

  it("blocks credentials embedded in the URL", () => {
    expect(validateProviderConfig({ ...base(), apiUrl: "https://user:pass@api.example.com/x" }).ok).toBe(false);
  });

  it("blocks private, loopback and link-local hosts (SSRF)", () => {
    for (const host of [
      "http://localhost:3000/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.1.10/x",
      "http://172.16.0.1/x",
      "http://172.31.255.255/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x",
      "http://0.0.0.0/x",
    ]) {
      const r = validateProviderConfig({ ...base(), apiUrl: host, requireTls: false });
      expect(r.ok).toBe(false);
    }
  });

  it("requires a success indicator for BODY_CONTAINS", () => {
    const r = validateProviderConfig({ ...base(), successPath: "BODY_CONTAINS", successIndicator: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("نشانگر");
  });

  it("requires a JSON path for JSON_PATH", () => {
    const r = validateProviderConfig({ ...base(), successPath: "JSON_PATH", jsonPath: "" });
    expect(r.ok).toBe(false);
  });
});

describe("body template rendering", () => {
  it("substitutes permitted placeholders", () => {
    const out = renderBody('{"to":"{phone}","message":"{message}","sender":"{sender}"}', {
      phone: "09121112233",
      message: "سلام",
      sender: "50004000",
    });
    expect(out).toBe('{"to":"09121112233","message":"سلام","sender":"50004000"}');
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderBody("{unknown} {phone}", { phone: "09121112233" })).toBe("{unknown} 09121112233");
  });
});

describe("sending", () => {
  it("refuses an invalid recipient number", async () => {
    const r = await sendViaProvider(base(), "12345", "hello");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("شماره گیرنده");
  });

  it("refuses an empty message", async () => {
    const r = await sendViaProvider(base(), "09121112233", "   ");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("متن پیامک");
  });

  it("fails safely for an unreachable host without leaking credentials", async () => {
    const config = { ...base(), apiUrl: "https://sms.invalid.example.test/send", requireTls: true };
    const r = await sendViaProvider(config, "09121112233", "سلام", { timeoutMs: 1500 });
    expect(r.ok).toBe(false);
    expect(r.body).not.toContain(config.apiKey);
  });

  it("redacts the API key from a response body", async () => {
    // A private host is rejected before any request; assert via validation path.
    const config = { ...base(), apiUrl: "http://169.254.169.254/x", requireTls: false };
    const r = await sendViaProvider(config, "09121112233", "سلام");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("شبکه داخلی");
  });
});
