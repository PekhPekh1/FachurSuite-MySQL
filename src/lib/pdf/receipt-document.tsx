import path from "path";
import React from "react";
import { Document, Page, StyleSheet, Text, View, Font } from "@react-pdf/renderer";
import { faNumber, ltr, maskCard, shapePersian } from "./persian";

/**
 * Fonts are loaded by absolute filesystem path. `import.meta.url` cannot be used
 * here because the Next.js server bundle relocates modules, which would break
 * font resolution at runtime.
 */
const fontPath = (name: string) => path.join(process.cwd(), "public", "fonts", name);

Font.register({
  family: "Vazirmatn",
  fonts: [
    { src: fontPath("Vazirmatn-Regular.ttf"), fontWeight: 400 },
    { src: fontPath("Vazirmatn-Bold.ttf"), fontWeight: 700 },
  ],
});

const styles = StyleSheet.create({
  page: { fontFamily: "Vazirmatn", fontSize: 10, padding: 36, direction: "ltr" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#cbd5e1" },
  storeName: { fontSize: 15, fontWeight: 700 },
  muted: { fontSize: 8, color: "#64748b", marginTop: 2 },
  docTitle: { fontSize: 13, fontWeight: 700, textAlign: "left" },
  section: { marginTop: 14 },
  sectionTitle: { fontSize: 10, fontWeight: 700, marginBottom: 5, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "33%", paddingVertical: 2 },
  cellWide: { width: "66%", paddingVertical: 2 },
  label: { fontSize: 7.5, color: "#64748b" },
  value: { fontSize: 9.5, marginTop: 1 },
  tableHeader: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 4 },
  tableRow: { flexDirection: "row", paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: "#eef2f7" },
  colDesc: { width: "50%", paddingHorizontal: 4 },
  colDue: { width: "25%", paddingHorizontal: 4 },
  colAmount: { width: "25%", paddingHorizontal: 4, textAlign: "right" },
  totals: { marginTop: 12, padding: 10, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: "#cbd5e1", fontSize: 12, fontWeight: 700 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 42, paddingHorizontal: 20 },
  signature: { width: "45%", textAlign: "center", borderTopWidth: 1, borderTopColor: "#94a3b8", paddingTop: 4, fontSize: 8, color: "#64748b" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, textAlign: "center", fontSize: 7, color: "#94a3b8" },
  penaltyNote: { marginTop: 8, fontSize: 8, color: "#b45309" },
});

const S = shapePersian;

export interface ReceiptData {
  storeName: string;
  storePhone?: string | null;
  storeAddress?: string | null;
  receiptNo: string;
  contractNo: string;
  customerName: string;
  customerNationalCode: string;
  customerMobile: string;
  itemDescription: string;
  amount: number;
  penaltyAmount: number;
  method: string;
  referenceNo?: string | null;
  sourceCardNumber?: string | null;
  paidAt: string;
  isSettlement: boolean;
  verifiedBy?: string | null;
  lines: { seq: number; dueDate: string; amount: number; penalty: number }[];
}

export function ReceiptDocument(data: ReceiptData) {
  const principal = data.amount - data.penaltyAmount;
  return (
    <Document title={S(`رسید پرداخت ${data.receiptNo}`)} author={S(data.storeName)}>
      <Page size="A5" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.storeName}>{S(data.storeName)}</Text>
            {data.storePhone ? <Text style={styles.muted}>{ltr(data.storePhone)}</Text> : null}
            {data.storeAddress ? <Text style={styles.muted}>{S(data.storeAddress)}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>{S("رسید پرداخت")}</Text>
            <Text style={styles.muted}>{ltr(data.receiptNo)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{S("مشخصات مشتری")}</Text>
          <View style={styles.grid}>
            <View style={styles.cellWide}>
              <Text style={styles.label}>{S("نام و نام خانوادگی")}</Text>
              <Text style={styles.value}>{S(data.customerName)}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.label}>{S("کد ملی")}</Text>
              <Text style={styles.value}>{ltr(data.customerNationalCode)}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.label}>{S("موبایل")}</Text>
              <Text style={styles.value}>{ltr(data.customerMobile)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{S("اطلاعات پرداخت")}</Text>
          <View style={styles.grid}>
            <View style={styles.cell}>
              <Text style={styles.label}>{S("شماره قرارداد")}</Text>
              <Text style={styles.value}>{ltr(data.contractNo)}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.label}>{S("روش پرداخت")}</Text>
              <Text style={styles.value}>{S(data.method)}</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.label}>{S("تاریخ و ساعت پرداخت")}</Text>
              <Text style={styles.value}>{S(data.paidAt)}</Text>
            </View>
            {data.referenceNo ? (
              <View style={styles.cell}>
                <Text style={styles.label}>{S("شماره پیگیری")}</Text>
                <Text style={styles.value}>{ltr(data.referenceNo)}</Text>
              </View>
            ) : null}
            {data.sourceCardNumber ? (
              <View style={styles.cell}>
                <Text style={styles.label}>{S("کارت مبدأ")}</Text>
                <Text style={styles.value}>{ltr(maskCard(data.sourceCardNumber))}</Text>
              </View>
            ) : null}
            {data.verifiedBy ? (
              <View style={styles.cell}>
                <Text style={styles.label}>{S("تأییدکننده")}</Text>
                <Text style={styles.value}>{S(data.verifiedBy)}</Text>
              </View>
            ) : null}
            <View style={styles.cellWide}>
              <Text style={styles.label}>{S("شرح کالا / خدمت")}</Text>
              <Text style={styles.value}>{S(data.itemDescription)}</Text>
            </View>
          </View>
        </View>

        {data.lines.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{S("اقساط پرداخت‌شده")}</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colDesc}>{S("قسط")}</Text>
              <Text style={styles.colDue}>{S("سررسید")}</Text>
              <Text style={styles.colAmount}>{S("مبلغ (تومان)")}</Text>
            </View>
            {data.lines.map((line) => (
              <View key={line.seq} style={styles.tableRow} wrap={false}>
                <Text style={styles.colDesc}>{S(`قسط شماره ${line.seq}`)}</Text>
                <Text style={styles.colDue}>{S(line.dueDate)}</Text>
                <Text style={styles.colAmount}>{faNumber(line.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <Text>{S("اصل مبلغ")}</Text>
            <Text>{`${faNumber(principal)} ${S("تومان")}`}</Text>
          </View>
          {data.penaltyAmount > 0 ? (
            <View style={styles.totalRow}>
              <Text>{S("جریمه تأخیر")}</Text>
              <Text>{`${faNumber(data.penaltyAmount)} ${S("تومان")}`}</Text>
            </View>
          ) : null}
          <View style={styles.grand}>
            <Text>{S("جمع کل دریافت‌شده")}</Text>
            <Text>{`${faNumber(data.amount)} ${S("تومان")}`}</Text>
          </View>
          {data.penaltyAmount > 0 ? (
            <Text style={styles.penaltyNote}>
              {S("جریمه تأخیر بر اساس تنظیمات مالی فروشگاه و پس از مهلت ارفاق محاسبه شده است.")}
            </Text>
          ) : null}
          {data.isSettlement ? (
            <Text style={styles.penaltyNote}>{S("این پرداخت مربوط به تسویه کامل قرارداد است.")}</Text>
          ) : null}
        </View>

        <View style={styles.signatures}>
          <Text style={styles.signature}>{S("امضای پرداخت‌کننده")}</Text>
          <Text style={styles.signature}>{S("امضای فروشگاه")}</Text>
        </View>

        <Text style={styles.footer} fixed>
          {S("این رسید به‌صورت الکترونیکی صادر شده است.")}
        </Text>
      </Page>
    </Document>
  );
}
