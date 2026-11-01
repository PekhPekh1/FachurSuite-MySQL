import { z } from "zod";

export const loginSchema = z.object({
  username: z.string().trim().min(3, "نام کاربری را وارد کنید").max(60),
  password: z.string().min(1, "رمز عبور را وارد کنید").max(100),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید"),
    newPassword: z
      .string()
      .min(8, "رمز عبور جدید حداقل ۸ کاراکتر است")
      .max(100)
      .regex(/[A-Za-zآ-ی]/, "رمز عبور باید حداقل یک حرف داشته باشد")
      .regex(/[0-9۰-۹]/, "رمز عبور باید حداقل یک عدد داشته باشد"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "رمز عبور جدید باید با رمز فعلی متفاوت باشد",
  });
