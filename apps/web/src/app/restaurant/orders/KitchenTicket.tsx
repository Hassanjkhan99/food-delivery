"use client";

// Kitchen ticket / order slip (#46). Opens a dedicated print window with a receipt-width
// layout (58mm-ish), large-print items + modifiers, notes, a cutlery flag and the COD
// amount to collect. We render into a fresh window rather than print-CSS on the board so
// the busy live board isn't disturbed and thermal printers get a clean, isolated page.
import { formatRs } from "@fd/shared";

export type TicketItem = {
  qty: number;
  name: string;
  modifiers?: Array<{ name?: string } | string> | null;
  notes?: string | null;
};

export type TicketOrder = {
  code: string;
  placedAt?: string | null;
  paymentMode: string;
  grandTotalMinor: number;
  customerNote?: string | null;
  cutleryRequested?: boolean | null;
  items: TicketItem[];
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

function modLabel(m: { name?: string } | string): string {
  return typeof m === "string" ? m : (m.name ?? "");
}

export function printKitchenTicket(order: TicketOrder) {
  if (typeof window === "undefined") return;
  const w = window.open("", "_blank", "width=380,height=640");
  if (!w) return;

  const time = order.placedAt
    ? new Date(order.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const isCod = order.paymentMode === "cod";

  const itemsHtml = order.items
    .map((it) => {
      const mods = (it.modifiers ?? [])
        .map(modLabel)
        .filter(Boolean)
        .map((m) => `<div class="mod">+ ${esc(m)}</div>`)
        .join("");
      const note = it.notes ? `<div class="note">“${esc(it.notes)}”</div>` : "";
      return `<div class="line"><div class="row"><span class="qty">${it.qty}×</span><span class="name">${esc(
        it.name,
      )}</span></div>${mods}${note}</div>`;
    })
    .join("");

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>${esc(
    order.code,
  )}</title><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: ui-monospace, Menlo, Consolas, monospace; padding:12px; width:320px; color:#000; }
    h1 { font-size:22px; text-align:center; letter-spacing:1px; }
    .meta { text-align:center; font-size:12px; margin:4px 0 8px; }
    hr { border:none; border-top:1px dashed #000; margin:8px 0; }
    .line { margin-bottom:8px; }
    .row { display:flex; gap:6px; font-size:18px; font-weight:700; }
    .qty { min-width:28px; }
    .mod { font-size:14px; margin-left:34px; }
    .note { font-size:14px; margin-left:34px; font-style:italic; }
    .flag { font-size:15px; font-weight:700; margin-top:6px; }
    .cod { font-size:18px; font-weight:800; text-align:center; margin-top:8px; border:2px solid #000; padding:6px; }
  </style></head><body>
    <h1>${esc(order.code)}</h1>
    <div class="meta">${esc(time)}</div>
    <hr/>
    ${itemsHtml || "<div>(no items)</div>"}
    <hr/>
    ${order.customerNote ? `<div class="flag">Note: ${esc(order.customerNote)}</div>` : ""}
    <div class="flag">Cutlery: ${order.cutleryRequested ? "YES" : "no"}</div>
    ${
      isCod
        ? `<div class="cod">COLLECT ${esc(formatRs(order.grandTotalMinor))} (COD)</div>`
        : `<div class="flag">PAID — ${esc(formatRs(order.grandTotalMinor))}</div>`
    }
    <script>window.onload=function(){window.focus();window.print();};</script>
  </body></html>`);
  w.document.close();
}
