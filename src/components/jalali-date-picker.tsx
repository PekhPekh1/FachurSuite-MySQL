"use client";

import DatePicker from "react-multi-date-picker";
import DateObject from "react-date-object";
import persian from "react-date-object/calendars/persian";
import persian_fa from "react-date-object/locales/persian_fa";
import gregorian from "react-date-object/calendars/gregorian";

/**
 * Jalali date input. `value`/`onChange` always use Gregorian ISO (YYYY-MM-DD)
 * for storage; display is always Jalali/Persian.
 */
export function JalaliDatePicker({
  value,
  onChange,
  placeholder = "انتخاب تاریخ",
}: {
  value?: string | null;
  onChange: (greg: string | null) => void;
  placeholder?: string;
}) {
  const dateObj = value
    ? new DateObject({ date: value, format: "YYYY-MM-DD", calendar: gregorian }).convert(persian, persian_fa)
    : null;

  return (
    <DatePicker
      calendar={persian}
      locale={persian_fa}
      calendarPosition="bottom-start"
      value={dateObj}
      onChange={(d) => {
        if (!d) return onChange(null);
        const g = new DateObject(d).convert(gregorian);
        onChange(g.format("YYYY-MM-DD"));
      }}
      format="YYYY/MM/DD"
      inputClass="rmdp-input"
      containerClassName="rmdp-container"
      placeholder={placeholder}
    />
  );
}
