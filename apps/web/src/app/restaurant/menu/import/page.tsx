"use client";

// Menu digitization wizard: upload the PHYSICAL menu (photos/PDF) as reference docs,
// transcribe items side-by-side into the draft, or bulk-import a CSV with preview.
import { useState } from "react";
import Link from "next/link";
import { useClient, useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { useConsole } from "../../useConsole";
import { uploadFile } from "@/lib/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const SourceDocsQuery = graphql(`
  query SourceDocs($branchId: String!) {
    menuSourceDocs(branchId: $branchId) {
      id
      kind
      status
      asset {
        id
        url
        contentType
      }
    }
    draftMenu(branchId: $branchId) {
      id
      version
      categories {
        id
        name
        items {
          id
          name
        }
      }
    }
  }
`);

const RegisterDocMutation = graphql(`
  mutation RegisterDoc($branchId: String!, $assetId: String!, $kind: String!) {
    registerMenuSourceDoc(branchId: $branchId, assetId: $assetId, kind: $kind) {
      id
    }
  }
`);

const QuickAddMutation = graphql(`
  mutation QuickAdd($branchId: String!, $categoryId: String!, $name: String!, $priceMinor: Int!) {
    upsertMenuItem(
      branchId: $branchId
      categoryId: $categoryId
      name: $name
      priceMinor: $priceMinor
    ) {
      id
      name
    }
  }
`);

const QuickCategoryMutation = graphql(`
  mutation QuickCategory($branchId: String!, $name: String!) {
    upsertCategory(branchId: $branchId, name: $name) {
      id
      name
    }
  }
`);

const PreviewCsvMutation = graphql(`
  mutation PreviewCsv($assetId: String!) {
    previewMenuCsv(assetId: $assetId) {
      line
      category
      name
      description
      priceMinor
      error
    }
  }
`);

const ImportCsvMutation = graphql(`
  mutation ImportCsv($branchId: String!, $assetId: String!) {
    importMenuCsvToDraft(branchId: $branchId, assetId: $assetId) {
      created
      updated
    }
  }
`);

type CsvPreviewRow = {
  line: number;
  category: string;
  name: string;
  priceMinor: number;
  error?: string | null;
};

export default function MenuImportPage() {
  const { branch, isOwner } = useConsole();
  const client = useClient();
  const [{ data }, refetch] = useQuery({
    query: SourceDocsQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch || !isOwner,
    requestPolicy: "cache-and-network",
  });
  const [, registerDoc] = useMutation(RegisterDocMutation);
  const [, quickAdd] = useMutation(QuickAddMutation);
  const [, quickCategory] = useMutation(QuickCategoryMutation);
  const [, previewCsv] = useMutation(PreviewCsvMutation);
  const [importState, importCsv] = useMutation(ImportCsvMutation);

  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [csvAssetId, setCsvAssetId] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<CsvPreviewRow[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({ categoryId: "", name: "", priceRs: "" });

  if (!branch) return <p className="text-kd-fg-muted">Complete onboarding first.</p>;
  // Owner-only surface (#204): match the resolver-level gate on menu import.
  if (!isOwner)
    return <p className="text-kd-fg-muted">Only the restaurant owner can manage the menu.</p>;

  const docs = data?.menuSourceDocs ?? [];
  const draft = data?.draftMenu;
  const active = docs.find((d) => d.id === activeDoc) ?? docs[0];
  const refresh = () => refetch({ requestPolicy: "network-only" });

  async function onSourceUpload(file: File) {
    setMessage(null);
    try {
      const isPdf = file.type === "application/pdf";
      const { assetId } = await uploadFile(client, file, isPdf ? "document" : "image");
      await registerDoc({ branchId: branch!.id, assetId, kind: isPdf ? "pdf" : "photo" });
      refresh();
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  async function onCsvUpload(file: File) {
    setMessage(null);
    setCsvRows(null);
    try {
      const { assetId } = await uploadFile(client, file, "csv");
      setCsvAssetId(assetId);
      const r = await previewCsv({ assetId });
      if (r.error) throw new Error(r.error.graphQLErrors[0]?.message ?? "Preview failed");
      setCsvRows((r.data?.previewMenuCsv ?? []) as CsvPreviewRow[]);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }

  return (
    <main className="max-w-5xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Bring your menu online</h1>
          <p className="text-sm text-kd-fg-muted">
            Upload your physical menu, then transcribe it — your digital menu mirrors the real one.
          </p>
        </div>
        <Link href="/restaurant/menu" className="text-sm underline">
          ← Menu manager
        </Link>
      </div>

      {message && (
        <p className="mb-4 rounded-lg bg-kd-danger-soft px-3 py-2 text-sm text-kd-danger">
          {message}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: source documents */}
        <section className="rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Your menu (reference)</h2>
            <label className="cursor-pointer rounded-lg border border-kd-border px-3 py-1 text-xs font-medium hover:bg-kd-surface-muted">
              + Upload photo/PDF
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onSourceUpload(e.target.files[0])}
              />
            </label>
          </div>

          {docs.length === 0 && (
            <p className="py-12 text-center text-sm text-kd-fg-subtle">
              Upload photos of your in-restaurant menu to transcribe from.
            </p>
          )}

          {docs.length > 0 && (
            <>
              <div className="mb-2 flex gap-1 overflow-x-auto">
                {docs.map((d, i) => (
                  <button
                    key={d.id}
                    onClick={() => setActiveDoc(d.id)}
                    className={`rounded px-2 py-1 text-xs ${active?.id === d.id ? "bg-kd-primary text-white" : "bg-kd-surface-muted"}`}
                  >
                    {d.kind} {i + 1}
                  </button>
                ))}
              </div>
              {active?.asset.contentType === "application/pdf" ? (
                <iframe
                  src={active.asset.url ?? ""}
                  className="h-96 w-full rounded-lg border"
                  title="menu pdf"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={active?.asset.url ?? ""}
                  alt="menu source"
                  className="max-h-96 w-full rounded-lg object-contain"
                />
              )}
            </>
          )}
        </section>

        {/* Right: transcribe into the draft */}
        <section className="space-y-4">
          <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
            <h2 className="mb-3 font-semibold">Transcribe an item → draft v{draft?.version}</h2>
            <div className="space-y-3 text-sm">
              <div className="flex gap-2">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className="flex-1 rounded-lg border border-kd-border px-2 py-1.5"
                >
                  <option value="">Choose category…</option>
                  {draft?.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.items.length})
                    </option>
                  ))}
                </select>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={async () => {
                    const name = prompt("New category name:");
                    if (name?.trim()) {
                      await quickCategory({ branchId: branch.id, name });
                      refresh();
                    }
                  }}
                >
                  + Category
                </Button>
              </div>
              <div>
                <Label>Item name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Price (Rs)</Label>
                <Input
                  inputMode="decimal"
                  value={form.priceRs}
                  onChange={(e) => setForm({ ...form, priceRs: e.target.value })}
                  className="mt-1"
                />
              </div>
              <Button
                className="w-full"
                disabled={!form.categoryId || !form.name || !Number(form.priceRs)}
                onClick={async () => {
                  const r = await quickAdd({
                    branchId: branch.id,
                    categoryId: form.categoryId,
                    name: form.name,
                    priceMinor: Math.round(Number(form.priceRs) * 100),
                  });
                  if (r.error) {
                    setMessage(r.error.graphQLErrors[0]?.message ?? "Add failed");
                    return;
                  }
                  setForm({ ...form, name: "", priceRs: "" });
                  refresh();
                }}
              >
                Add to draft
              </Button>
              <p className="text-xs text-kd-fg-subtle">
                Modifiers, photos and descriptions can be added later in the menu manager. Publish
                from there when you&apos;re done.
              </p>
            </div>
          </div>

          {/* CSV import */}
          <div className="rounded-xl border border-kd-border bg-kd-surface p-4">
            <h2 className="mb-2 font-semibold">Bulk import (CSV)</h2>
            <p className="mb-3 text-xs text-kd-fg-subtle">
              Columns: <code>category, name, description, price</code> (price in Rs).
            </p>
            <label className="cursor-pointer rounded-lg border border-kd-border px-3 py-1.5 text-xs font-medium hover:bg-kd-surface-muted">
              Choose CSV…
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onCsvUpload(e.target.files[0])}
              />
            </label>

            {csvRows && (
              <div className="mt-3">
                <div className="max-h-48 overflow-y-auto rounded-lg border border-kd-border text-xs">
                  <table className="w-full">
                    <thead className="bg-kd-surface-muted text-left">
                      <tr>
                        <th className="p-1.5">Category</th>
                        <th className="p-1.5">Item</th>
                        <th className="p-1.5">Price</th>
                        <th className="p-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r) => (
                        <tr key={r.line} className={r.error ? "bg-kd-danger-soft" : ""}>
                          <td className="p-1.5">{r.category}</td>
                          <td className="p-1.5">{r.name}</td>
                          <td className="p-1.5">{r.error ? "—" : formatRs(r.priceMinor)}</td>
                          <td className="p-1.5">
                            {r.error ? (
                              <Badge variant="destructive">{r.error}</Badge>
                            ) : (
                              <Badge variant="secondary">ok</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  className="mt-2 w-full"
                  disabled={importState.fetching || csvRows.every((r) => r.error)}
                  onClick={async () => {
                    const r = await importCsv({ branchId: branch.id, assetId: csvAssetId! });
                    if (r.error) {
                      setMessage(r.error.graphQLErrors[0]?.message ?? "Import failed");
                      return;
                    }
                    setMessage(
                      `Imported: ${r.data?.importMenuCsvToDraft.created} new, ${r.data?.importMenuCsvToDraft.updated} updated. Review & publish in the menu manager.`,
                    );
                    setCsvRows(null);
                    refresh();
                  }}
                >
                  Import {csvRows.filter((r) => !r.error).length} valid rows into draft
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
