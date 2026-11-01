import type { CookieOptions, Request, Response } from "express";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

export function parseCookies(req: Request): Record<string, string> {
  const value = req.headers.cookie;
  if (!value) return {};
  return Object.fromEntries(
    value.split(";").flatMap((part) => {
      const at = part.indexOf("=");
      if (at < 1) return [];
      try {
        return [[part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}

const base = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
});

export function setAuthCookies(
  res: Response,
  pair: { accessToken: string; accessExpiresAt: Date; refreshToken: string; refreshExpiresAt: Date },
) {
  res.cookie(ACCESS_COOKIE, pair.accessToken, { ...base(), expires: pair.accessExpiresAt });
  res.cookie(REFRESH_COOKIE, pair.refreshToken, { ...base(), expires: pair.refreshExpiresAt });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, base());
  res.clearCookie(REFRESH_COOKIE, base());
}
