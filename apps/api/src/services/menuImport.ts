// CSV menu import: header `category,name,description,price` (price in Rs).
// Preview returns parsed+validated rows; import merges them into the draft menu.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";
import { env } from "../env.js";
import { ensureDraft } from "./menuService.js";

export type CsvRow = {
  line: number;
  category: string;
  name: string;
  description: string;
  priceMinor: number;
  error: string | null;
};

/** Minimal CSV parser with quoted-field support. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export async function parseMenuCsvAsset(userId: string, assetId: string): Promise<CsvRow[]> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerId !== userId)
    throw new GraphQLError("We couldn't find that CSV file.", {
      extensions: { code: "not_found" },
    });
  if (asset.status !== "finalized")
    throw new GraphQLError(
      "This file hasn't finished uploading yet. Please try again in a moment.",
      {
        extensions: { code: "invalid_state" },
      },
    );

  const path = resolve(join(resolve(env.storageDir), asset.objectKey));
  const text = await readFile(path, "utf8");
  const rows = parseCsv(text);
  if (rows.length < 2)
    throw new GraphQLError("Your CSV needs a header row and at least one menu item.", {
      extensions: { code: "validation_error" },
    });

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("category") < 0 || col("name") < 0 || col("price") < 0) {
    throw new GraphQLError(
      "Your CSV header must include the columns category, name, and price (description is optional).",
      { extensions: { code: "validation_error" } },
    );
  }

  return rows.slice(1).map((r, i) => {
    const category = (r[col("category")] ?? "").trim();
    const name = (r[col("name")] ?? "").trim();
    const description = col("description") >= 0 ? (r[col("description")] ?? "").trim() : "";
    const priceRaw = (r[col("price")] ?? "").trim().replace(/[^\d.]/g, "");
    const priceMinor = Math.round(Number(priceRaw) * 100);
    let error: string | null = null;
    if (!category) error = "Missing category";
    else if (!name) error = "Missing item name";
    else if (!Number.isFinite(priceMinor) || priceMinor <= 0) error = "Invalid price";
    return { line: i + 2, category, name, description, priceMinor, error };
  });
}

/**
 * Merge already-validated rows into the branch's draft menu: categories matched by name
 * (case-insensitive), items upserted within their category. Shared by CSV import and the
 * OCR import path (#177) so both feed the exact same draft-merge logic. Callers pass only
 * error-free rows (an empty list throws — nothing to import).
 */
export async function mergeMenuRows(branchId: string, rows: CsvRow[]) {
  if (rows.length === 0)
    throw new GraphQLError("There are no valid rows to import.", {
      extensions: { code: "validation_error" },
    });

  const draft = await ensureDraft(branchId);
  const categories = await prisma.menuCategory.findMany({ where: { menuId: draft.id } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    let cat = catByName.get(row.category.toLowerCase());
    if (!cat) {
      cat = await prisma.menuCategory.create({
        data: { menuId: draft.id, name: row.category, sortOrder: catByName.size },
      });
      catByName.set(row.category.toLowerCase(), cat);
    }
    const existing = await prisma.menuItem.findFirst({
      where: { categoryId: cat.id, name: { equals: row.name, mode: "insensitive" } },
    });
    if (existing) {
      await prisma.menuItem.update({
        where: { id: existing.id },
        data: { priceMinor: row.priceMinor, description: row.description || existing.description },
      });
      updated++;
    } else {
      await prisma.menuItem.create({
        data: {
          categoryId: cat.id,
          name: row.name,
          description: row.description || null,
          priceMinor: row.priceMinor,
        },
      });
      created++;
    }
  }
  return { created, updated, skipped: 0 };
}

/** Import a CSV asset into the draft: parse + validate the upload, then merge valid rows. */
export async function importMenuCsv(userId: string, branchId: string, assetId: string) {
  const rows = (await parseMenuCsvAsset(userId, assetId)).filter((r) => !r.error);
  return mergeMenuRows(branchId, rows);
}
