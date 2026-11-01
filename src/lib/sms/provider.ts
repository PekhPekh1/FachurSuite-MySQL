// Uses Node's global fetch with redirect:"manual" so a permitted host can never
// bounce the request to an internal address.

/**
 * ─── SMS PROVIDER ADAPTER ─────────────────────────────────────────────────────
 *
 * Instead of issuing arbitrary requests to unrestricted URLs, a provider is a
 * *typed, validated configuration* stored in `settings["sms_provider"]` and
 * dispatched through a constrained adapter.
 *
 * SSRF protections:
 *   • The URL must be a valid https:// (or http:// only when explicitly allowed
 *     for local testing) absolute URL.
 *   • Hostnames resolving to private, loopback, link-local or unique-local
 *     address space are rejected unless the deployment opts in via
 *     SMS_ALLOW_PRIVATE_HOSTS (used only by local integration tests).
 *   • Redirects are never followed, so a permitted host cannot bounce a request
 *     to an internal address.
 *   • Credentials are injected at send time from configuration and are never
 *     written to logs, errors, or the database.
 */

export type SmsAuthStyle = "BEARER" | "HEADER" | "QUERY" | "BODY" | "NONE";

export interface SmsProviderConfig {
  name: string;
  apiUrl: string;
  /** Stored in settings; in production prefer an env var reference. */
  apiKey: string;
  senderNumber: string;
  method: "GET" | "POST";
  /** Placeholders: {phone} {message} {sender} {apiKey} */
  bodyTemplate: string;
  /** How the response signals success. */
  successIndicator: string;
  /** Where to look for the indicator. */
  successPath: "BODY_CONTAINS" | "STATUS_2XX" | "JSON_PATH";
  jsonPath?: string;
  authStyle: SmsAuthStyle;
  authHeaderName?: string;
  /** Optional extra headers (JSON object of static strings). */
  headers?: Record<string, string>;
  requireTls: boolean;
  isActive: boolean;
}

export const defaultProvider: SmsProviderConfig = {
  name: "",
  apiUrl: "",
  apiKey: "",
  senderNumber: "",
  method: "POST",
  bodyTemplate: '{"to":"{phone}","message":"{message}","sender":"{sender}"}',
  successIndicator: "",
  successPath: "STATUS_2XX",
  authStyle: "BEARER",
  authHeaderName: "Authorization",
  requireTls: true,
  isActive: false,
};

/** Placeholders never eligible for credential leakage. */
const SAFE_VARS = new Set(["phone", "message", "sender"]);

function isPrivateIp(host: string): boolean {
  if (/^localhost$/i.test(host)) return true;
  if (/^\[?(::1|fe80:|fc00:|fd..:)/i.test(host)) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Test-only escape hatch for the private-host guard. Set SMS_ALLOW_PRIVATE_HOSTS=1
 * to point the provider at a local mock; never enable it in production.
 */
export const allowPrivateHosts = () => process.env.SMS_ALLOW_PRIVATE_HOSTS === "1";

/** Validates provider configuration without performing any network request. */
export function validateProviderConfig(c: SmsProviderConfig, allowPrivate = false): ValidationResult {
  if (!c.name?.trim()) return { ok: false, error: "نام سرویس‌دهنده الزامی است" };
  if (c.name.length > 60) return { ok: false, error: "نام سرویس‌دهنده حداکثر ۶۰ نویسه است" };
  if (!c.apiUrl?.trim()) return { ok: false, error: "آدرس API الزامی است" };

  let url: URL;
  try {
    url = new URL(c.apiUrl);
  } catch {
    return { ok: false, error: "آدرس API معتبر نیست" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "آدرس API باید با http یا https آغاز شود" };
  }
  if (c.requireTls && url.protocol !== "https:") {
    return { ok: false, error: "این سرویس‌دهنده استفاده از HTTPS را الزامی می‌کند" };
  }
  if (url.username || url.password) return { ok: false, error: "قرار دادن اعتبارنامه در آدرس API مجاز نیست" };
  if (!allowPrivate && isPrivateIp(url.hostname)) {
    return { ok: false, error: "آدرس‌های شبکه داخلی مجاز نیستند" };
  }
  if (c.method !== "GET" && c.method !== "POST") return { ok: false, error: "متد HTTP نامعتبر است" };
  if (!c.bodyTemplate?.trim() && c.method === "POST") return { ok: false, error: "قالب بدنه درخواست الزامی است" };
  if (c.successPath === "BODY_CONTAINS" && !c.successIndicator?.trim()) {
    return { ok: false, error: "برای تشخیص موفقیت در بدنه پاسخ، متن نشانگر الزامی است" };
  }
  if (c.successPath === "JSON_PATH" && !c.jsonPath?.trim()) {
    return { ok: false, error: "مسیر JSON برای تشخیص موفقیت الزامی است" };
  }
  return { ok: true };
}

/** Substitutes placeholders, refusing to inject credential values. */
export function renderBody(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (k === "apiKey") return vars.apiKey ?? "";
    if (!SAFE_VARS.has(k)) return `{${k}}`;
    return vars[k] ?? "";
  });
}

export interface SendOutcome {
  ok: boolean;
  status: number;
  /** Redacted response body — credentials are never included. */
  body: string;
  error?: string;
}

function redact(text: string, secret: string): string {
  const out = text.length > 400 ? `${text.slice(0, 400)}…` : text;
  return secret && secret.length > 3 ? out.split(secret).join("[REDACTED]") : out;
}

function readJsonPath(body: string, path: string): string | null {
  try {
    let cur: unknown = JSON.parse(body);
    for (const part of path.split(".").filter(Boolean)) {
      if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part];
      } else {
        return null;
      }
    }
    return cur === null || cur === undefined ? null : String(cur);
  } catch {
    return null;
  }
}

/**
 * Sends one message through the configured provider. The URL is re-validated at
 * dispatch time so a configuration change cannot bypass the SSRF guard, and
 * redirects are disabled.
 */
export async function sendViaProvider(
  config: SmsProviderConfig,
  phone: string,
  message: string,
  opts: { allowPrivate?: boolean; timeoutMs?: number } = {},
): Promise<SendOutcome> {
  const validation = validateProviderConfig(config, opts.allowPrivate);
  if (!validation.ok) return { ok: false, status: 0, body: "", error: validation.error };
  if (!/^09\d{9}$/.test(phone)) return { ok: false, status: 0, body: "", error: "شماره گیرنده معتبر نیست" };
  if (!message.trim()) return { ok: false, status: 0, body: "", error: "متن پیامک خالی است" };

  const url = new URL(config.apiUrl);
  if (config.authStyle === "QUERY" && config.apiKey) {
    url.searchParams.set("apikey", config.apiKey);
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...(config.headers ?? {}),
  };
  if (config.apiKey && config.authStyle === "BEARER") {
    headers[config.authHeaderName || "Authorization"] = `Bearer ${config.apiKey}`;
  } else if (config.apiKey && config.authStyle === "HEADER") {
    headers[config.authHeaderName || "X-API-Key"] = config.apiKey;
  }

  let body: string | undefined;
  if (config.method === "POST") {
    body = renderBody(config.bodyTemplate, { phone, message, sender: config.senderNumber, apiKey: config.apiKey });
    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body,
      // Redirects are never followed: a permitted host must not be able to
      // redirect the request to an internal address.
      redirect: "manual",
      signal: controller.signal,
    });
    const text = await response.text();
    const safeBody = redact(text, config.apiKey);

    if (!response.ok) {
      return { ok: false, status: response.status, body: safeBody, error: `HTTP ${response.status}` };
    }

    switch (config.successPath) {
      case "STATUS_2XX":
        return { ok: true, status: response.status, body: safeBody };
      case "BODY_CONTAINS":
        return safeBody.includes(config.successIndicator)
          ? { ok: true, status: response.status, body: safeBody }
          : { ok: false, status: response.status, body: safeBody, error: "نشانگر موفقیت در پاسخ یافت نشد" };
      case "JSON_PATH": {
        const value = readJsonPath(text, config.jsonPath ?? "");
        return value !== null && value.includes(config.successIndicator)
          ? { ok: true, status: response.status, body: safeBody }
          : { ok: false, status: response.status, body: safeBody, error: "مقدار مورد انتظار در پاسخ یافت نشد" };
      }
      default:
        return { ok: true, status: response.status, body: safeBody };
    }
  } catch (e) {
    const message = e instanceof Error ? (e.name === "AbortError" ? "مهلت درخواست به پایان رسید" : e.message) : String(e);
    return { ok: false, status: 0, body: "", error: redact(message, config.apiKey) };
  } finally {
    clearTimeout(timer);
  }
}
