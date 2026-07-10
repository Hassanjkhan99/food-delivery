// CSV builders for analytics exports & settlement reports (#29).
//
// Everything here is DERIVED live from Order/OrderItem/LedgerEntry/Payout — there
// are no stored aggregates and no schema changes. The settlement report is built
// so its `net` column reconciles against the same ledger movement the wallet uses
// (see settlementReportCsv): net = subtotal + tax + delivery − commission, which is
// exactly the restaurant:{id}:payable credit posted on delivery for a card order.
// The platform fee is a separate platform-revenue leg and is NOT part of net.
//
// Money is kept in minor units in the raw ledger math and rendered as decimal
// rupees in the CSV (2dp) so the file opens cleanly in Excel / BI tools.
import type { Order, OrderItem } from "@fd/db";

/**
 * Serialize a single CSV field. Quote when it contains a comma, quote, or newline.
 * Also neutralize CSV-injection: restaurant-controlled values (branch/menu names)
 * that begin with a formula trigger (=, +, -, @, or a leading tab/CR) are prefixed
 * with a single quote so Excel/BI tools treat them as text, not formulas.
 */
function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Build a CSV document (header + rows) with CRLF line endings (Excel-friendly). */
export function toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
  const lines = [headers, ...rows].map((cols) => cols.map(csvField).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Minor units → fixed 2dp decimal string (rupees). 12345 → "123.45". */
function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

function isoDate(d: Date | null | undefined): string {
  return d ? d.toISOString() : "";
}

// ── restaurant settlement report ─────────────────────────────────────────────

/**
 * Net booked to the restaurant for one delivered order, in minor units.
 * Mirrors ledgerService.onOrderDelivered's `restaurantShare`: the restaurant keeps
 * gross (subtotal+tax+delivery) minus commission. The platform fee is NOT deducted
 * here — it is a separate platform-revenue leg funded from the customer's grand
 * total, so the restaurant:{id}:payable movement (this net) never includes it.
 * Deducting it made every card row's net lower than the ledger by the platform fee.
 */
export function orderNetMinor(o: Pick<
  Order,
  "subtotalMinor" | "taxTotalMinor" | "deliveryFeeMinor" | "commissionMinor"
>): number {
  return (
    o.subtotalMinor +
    o.taxTotalMinor +
    o.deliveryFeeMinor -
    o.commissionMinor
  );
}

type SettlementOrder = Order & { branch: { name: string } };

export function settlementReportCsv(orders: SettlementOrder[]): string {
  const headers = [
    "order_code",
    "branch",
    "placed_at",
    "delivered_at",
    "status",
    "payment_mode",
    "gross",
    "subtotal",
    "tax",
    "delivery_fee",
    "tip",
    "commission",
    "platform_fee",
    "net_to_restaurant",
  ];
  const rows = orders.map((o) => [
    o.code,
    o.branch.name,
    isoDate(o.placedAt),
    isoDate(o.deliveredAt),
    o.status,
    o.paymentMode,
    money(o.grandTotalMinor),
    money(o.subtotalMinor),
    money(o.taxTotalMinor),
    money(o.deliveryFeeMinor),
    money(o.tipAmount),
    money(o.commissionMinor),
    money(o.platformFeeMinor),
    money(orderNetMinor(o)),
  ]);
  return toCsv(headers, rows);
}

// ── admin metrics / GMV / take-rate ──────────────────────────────────────────

// GMV = subtotal + tax + delivery over completed (delivered) orders (kickoff KPI).
// Take rate = platform revenue (commission + platform fee) / GMV.
type MetricsBucket = {
  period: string;
  orders: number;
  gmvMinor: number;
  platformRevenueMinor: number;
};

export function bucketMetrics(
  orders: Pick<
    Order,
    | "deliveredAt"
    | "subtotalMinor"
    | "taxTotalMinor"
    | "deliveryFeeMinor"
    | "commissionMinor"
    | "platformFeeMinor"
  >[],
  granularity: "day" | "week" | "month",
): MetricsBucket[] {
  const buckets = new Map<string, MetricsBucket>();
  for (const o of orders) {
    if (!o.deliveredAt) continue;
    const key = periodKey(o.deliveredAt, granularity);
    const b =
      buckets.get(key) ??
      { period: key, orders: 0, gmvMinor: 0, platformRevenueMinor: 0 };
    b.orders += 1;
    b.gmvMinor += o.subtotalMinor + o.taxTotalMinor + o.deliveryFeeMinor;
    b.platformRevenueMinor += o.commissionMinor + o.platformFeeMinor;
    buckets.set(key, b);
  }
  return [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/** Bucket key for a date. Uses UTC boundaries — deterministic across environments. */
function periodKey(d: Date, granularity: "day" | "week" | "month"): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (granularity === "month") return `${y}-${m}`;
  if (granularity === "week") {
    // ISO-ish week: Monday-start week number.
    const tmp = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3);
    const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
    const week =
      1 +
      Math.round(
        ((tmp.getTime() - firstThursday.getTime()) / 86_400_000 -
          3 +
          ((firstThursday.getUTCDay() + 6) % 7)) /
          7,
      );
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  return `${y}-${m}-${day}`;
}

export function adminMetricsCsv(buckets: MetricsBucket[]): string {
  const headers = [
    "period",
    "orders",
    "gmv",
    "platform_revenue",
    "take_rate_pct",
  ];
  const rows = buckets.map((b) => [
    b.period,
    b.orders,
    money(b.gmvMinor),
    money(b.platformRevenueMinor),
    b.gmvMinor > 0 ? ((b.platformRevenueMinor / b.gmvMinor) * 100).toFixed(2) : "0.00",
  ]);
  return toCsv(headers, rows);
}

// ── eIMS-aligned invoice export ──────────────────────────────────────────────

// PRA eIMS lookup primitives (see #18): invoice number, line items, qty, sale price,
// tax charge, gross total, ST charges, net total. We emit one row PER LINE ITEM so the
// export is invoice-line granular (PRA invoice-level requirement). The order-level tax
// (taxTotalMinor) is apportioned across lines pro-rata by line subtotal; the ST charge
// column is that apportioned tax and the tax-exclusive value is the line net.
type InvoiceOrder = Order & { items: OrderItem[]; branch: { name: string } };

type SnapshotShape = { name?: unknown };

function itemName(item: OrderItem): string {
  const snap = item.menuSnapshotJson as SnapshotShape | null;
  const n = snap && typeof snap.name === "string" ? snap.name : null;
  return n ?? "(item)";
}

export function eimsInvoiceCsv(orders: InvoiceOrder[]): string {
  const headers = [
    "invoice_number", // order code — serial per-branch invoice id
    "branch",
    "invoice_date",
    "payment_mode",
    "line_no",
    "item",
    "qty",
    "unit_price", // tax-exclusive unit price
    "line_value_excl_tax", // tax-exclusive line value
    "st_charge", // apportioned sales-tax (ST) charge for this line
    "line_value_incl_tax", // inclusive total for this line
  ];
  const rows: Array<Array<string | number | null>> = [];
  for (const o of orders) {
    // Apportion the order tax across lines by line subtotal. We round the running
    // *cumulative* tax at each line and take the per-line delta, so cumulative tax
    // is monotonically non-decreasing — every line's ST charge is ≥ 0 and the lines
    // still sum exactly to taxTotalMinor (the last delta absorbs the remainder).
    // Rounding each line independently could over-allocate and force a negative
    // remainder on the final invoice line.
    const lineSubtotal = o.items.reduce((s, it) => s + it.lineTotalMinor, 0);
    let cumulativeSubtotal = 0;
    let taxAssigned = 0;
    o.items.forEach((it, idx) => {
      cumulativeSubtotal += it.lineTotalMinor;
      const cumulativeTax =
        lineSubtotal > 0
          ? Math.round((o.taxTotalMinor * cumulativeSubtotal) / lineSubtotal)
          : 0;
      const lineTax = cumulativeTax - taxAssigned;
      taxAssigned = cumulativeTax;
      rows.push([
        o.code,
        o.branch.name,
        isoDate(o.deliveredAt ?? o.placedAt),
        o.paymentMode,
        idx + 1,
        itemName(it),
        it.qty,
        money(it.unitPriceMinor),
        money(it.lineTotalMinor),
        money(lineTax),
        money(it.lineTotalMinor + lineTax),
      ]);
    });
  }
  return toCsv(headers, rows);
}
