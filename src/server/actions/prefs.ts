"use server";

import { cookies } from "next/headers";
import { PALETTES, type Palette } from "@/lib/palettes";

export async function setPalette(palette: string) {
  const p = (PALETTES as readonly string[]).includes(palette) ? (palette as Palette) : "blue";
  (await cookies()).set("palette", p, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function setDigits(mode: string) {
  (await cookies()).set("digits", mode === "en" ? "en" : "fa", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
