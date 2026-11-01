import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { PALETTES, type Palette } from "@/lib/palettes";

export type ThemePreference = "light" | "dark" | "system";

export interface Preferences {
  theme: ThemePreference;
  palette: Palette;
  faDigits: boolean;
  /** True when the values came from the user record rather than cookies. */
  fromUser: boolean;
}

/**
 * Resolves appearance preferences. A signed-in user's stored preferences win;
 * otherwise the cookie values (set by the header controls) are used so guests
 * and the login screen still honour the chosen theme and palette.
 */
export async function getPreferences(): Promise<Preferences> {
  const jar = await cookies();
  const cookiePalette = jar.get("palette")?.value as Palette | undefined;
  const palette: Palette = cookiePalette && PALETTES.includes(cookiePalette) ? cookiePalette : "blue";
  const fa = (jar.get("digits")?.value ?? "fa") !== "en";

  const user = await getSessionUser().catch(() => null);
  if (user) {
    const [row] = await db
      .select({ prefTheme: users.prefTheme, prefPalette: users.prefPalette, prefFaDigits: users.prefFaDigits })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);
    if (row) {
      const theme = (["light", "dark", "system"] as string[]).includes(row.prefTheme) ? (row.prefTheme as ThemePreference) : "system";
      const userPalette = PALETTES.includes(row.prefPalette as Palette) ? (row.prefPalette as Palette) : palette;
      return { theme, palette: userPalette, faDigits: row.prefFaDigits, fromUser: true };
    }
  }
  return { theme: "system", palette, faDigits: fa, fromUser: false };
}

/** Backwards-compatible helpers used by existing pages. */
export async function faDigits(): Promise<boolean> {
  return (await getPreferences()).faDigits;
}

export async function getPalette(): Promise<Palette> {
  return (await getPreferences()).palette;
}
