import bcrypt from "bcryptjs";

/** bcrypt cost 12: strong for interactive login while still operationally practical. */
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
