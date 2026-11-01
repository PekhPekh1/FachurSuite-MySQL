import { Skeleton } from "@/components/ui";

export default function AppLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="در حال بارگذاری">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-80" />
      <span className="sr-only">در حال دریافت اطلاعات…</span>
    </div>
  );
}
