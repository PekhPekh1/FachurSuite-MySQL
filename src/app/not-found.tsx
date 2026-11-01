import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6" dir="rtl">
      <div className="card flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <FileQuestion className="size-12 text-muted" />
        <h1 className="text-xl font-bold">صفحه یافت نشد</h1>
        <p className="text-sm text-muted">نشانی واردشده وجود ندارد یا دسترسی شما به آن محدود است.</p>
        <Link href="/" className="btn btn-primary mt-2">بازگشت به خانه</Link>
      </div>
    </main>
  );
}
