"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

function toFa(s: string) {
  return s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

export interface MonthPoint {
  label: string;
  value: number;
}

export function MonthlyBars({ data, fa }: { data: MonthPoint[]; fa: boolean }) {
  const fmt = (v: number) => {
    const s = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)} میلیون` : v.toLocaleString("en-US");
    return fa ? toFa(s) : s;
  };
  return (
    <div dir="ltr" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)", fontFamily: "inherit" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tickFormatter={fmt} tick={{ fontSize: 10, fill: "var(--muted)", fontFamily: "inherit" }} tickLine={false} axisLine={false} width={70} />
          <Tooltip
            cursor={{ fill: "var(--brand-soft)" }}
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              const s = `${n.toLocaleString("en-US")} تومان`;
              return [fa ? toFa(s) : s, "مبلغ"];
            }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 12,
              fontFamily: "inherit",
              direction: "rtl",
            }}
          />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="var(--brand)" maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface MethodPoint {
  name: string;
  value: number;
}

const PIE_COLORS = ["var(--brand)", "#0d9488", "#d97706"];

export function MethodDonut({ data, fa }: { data: MethodPoint[]; fa: boolean }) {
  return (
    <div dir="ltr" className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={92} paddingAngle={3} strokeWidth={0}>
            {data.map((d, i) => (
              <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Legend
            formatter={(v: string) => <span style={{ color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}>{v}</span>}
          />
          <Tooltip
            formatter={(v) => {
              const n = typeof v === "number" ? v : Number(v);
              const s = `${n.toLocaleString("en-US")} تومان`;
              return [fa ? toFa(s) : s, "مبلغ"];
            }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              fontSize: 12,
              fontFamily: "inherit",
              direction: "rtl",
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
