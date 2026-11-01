import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-constants";

const PUBLIC_PATHS = ["/login"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api") || // API routes perform their own auth checks
    pathname.startsWith("/_next") ||
    // The service worker and manifest must be publicly reachable or PWA
    // registration breaks (a redirect to the login page serves HTML to the SW).
    pathname === "/sw.js" ||
    pathname === "/manifest.json" ||
    /\.(png|jpg|jpeg|svg|ico|woff2?|ttf|webmanifest|json|txt|js)$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Signature/expiry/role checks are always performed server-side; proxy only
  // avoids rendering a protected page when neither credential exists.
  const hasCredential = Boolean(req.cookies.get(ACCESS_COOKIE)?.value || req.cookies.get(REFRESH_COOKIE)?.value);
  if (!hasCredential) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
