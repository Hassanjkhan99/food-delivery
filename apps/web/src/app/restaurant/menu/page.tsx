"use client";

// Menu manager: edits the DRAFT in place; Publish clones it into the live version.
import { useState } from "react";
import { useClient, useMutation, useQuery } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { uploadFile } from "@/lib/upload";
import { useConsole } from "../useConsole";
import { ModifierGroupsEditor } from "./ModifierGroupsEditor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const DraftQuery = graphql(`
  query DraftMenu($branchId: String!) {
    draftMenu(branchId: $branchId) {
      id
      version
      status
      layoutJson
      combos {
        id
        name
        description
        priceMinor
        originalPriceMinor
        isAvailable
        items {
          id
          qty
          menuItem {
            id
            name
          }
        }
      }
      categories {
        id
        name
        description
        items {
          id
          name
          description
          priceMinor
          compareAtPriceMinor
          isAvailable
          badges
          imageUrl
          modifierGroups {
            id
            name
            minSelect
            maxSelect
            required
            options {
              id
              name
              priceDeltaMinor
              isAvailable
            }
          }
        }
      }
    }
  }
`);

const UpsertCategoryMutation = graphql(`
  mutation UpsertCategory($branchId: String!, $id: String, $name: String!, $description: String) {
    upsertCategory(branchId: $branchId, id: $id, name: $name, description: $description) {
      id
    }
  }
`);
const UpsertItemMutation = graphql(`
  mutation UpsertItem(
    $branchId: String!
    $categoryId: String!
    $id: String
    $name: String!
    $description: String
    $priceMinor: Int!
    $compareAtPriceMinor: Int
  ) {
    upsertMenuItem(
      branchId: $branchId
      categoryId: $categoryId
      id: $id
      name: $name
      description: $description
      priceMinor: $priceMinor
      compareAtPriceMinor: $compareAtPriceMinor
    ) {
      id
    }
  }
`);
const SetAvailabilityMutation = graphql(`
  mutation SetAvailability($itemId: String!, $available: Boolean!) {
    setItemAvailability(itemId: $itemId, available: $available) {
      id
      isAvailable
    }
  }
`);
const DeleteItemMutation = graphql(`
  mutation DeleteItem($itemId: String!) {
    deleteMenuItem(itemId: $itemId)
  }
`);
const SetItemPhotoMutation = graphql(`
  mutation SetMenuItemPhoto($menuItemId: String!, $mediaId: String) {
    setMenuItemPhoto(menuItemId: $menuItemId, mediaId: $mediaId) {
      id
      imageUrl
    }
  }
`);
const PublishMutation = graphql(`
  mutation Publish($branchId: String!) {
    publishMenu(branchId: $branchId) {
      id
      version
    }
  }
`);
const UpdateLayoutMutation = graphql(`
  mutation UpdateLayout($branchId: String!, $layoutJson: JSON!) {
    updateMenuLayout(branchId: $branchId, layoutJson: $layoutJson) {
      id
    }
  }
`);
const UpsertComboMutation = graphql(`
  mutation UpsertCombo(
    $branchId: String!
    $id: String
    $name: String!
    $description: String
    $priceMinor: Int!
  ) {
    upsertCombo(
      branchId: $branchId
      id: $id
      name: $name
      description: $description
      priceMinor: $priceMinor
    ) {
      id
    }
  }
`);
const DeleteComboMutation = graphql(`
  mutation DeleteCombo($comboId: String!) {
    deleteCombo(comboId: $comboId)
  }
`);
const SetComboAvailabilityMutation = graphql(`
  mutation SetComboAvailability($comboId: String!, $available: Boolean!) {
    setComboAvailability(comboId: $comboId, available: $available) {
      id
      isAvailable
    }
  }
`);
const AddComboItemMutation = graphql(`
  mutation AddComboItem($comboId: String!, $menuItemId: String!, $qty: Int) {
    addComboItem(comboId: $comboId, menuItemId: $menuItemId, qty: $qty) {
      id
    }
  }
`);
const RemoveComboItemMutation = graphql(`
  mutation RemoveComboItem($comboItemId: String!) {
    removeComboItem(comboItemId: $comboItemId) {
      id
    }
  }
`);

const DISPLAY_MODES = ["list", "grid", "compact"] as const;

type ItemDraft = {
  id?: string;
  categoryId: string;
  name: string;
  description: string;
  priceRs: string;
  // Optional "was" price for an item-level offer (#53). Blank = no offer.
  compareAtRs: string;
};

type ComboDraft = {
  id?: string;
  name: string;
  description: string;
  priceRs: string;
};

type ModifierGroupShape = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: { id: string; name: string; priceDeltaMinor: number }[];
};

export default function MenuManagerPage() {
  const { branch, restaurant, isOwner } = useConsole();
  const client = useClient();
  const [{ data, fetching }, refetch] = useQuery({
    query: DraftQuery,
    variables: { branchId: branch?.id ?? "" },
    pause: !branch || !isOwner,
    requestPolicy: "cache-and-network",
  });
  const [, upsertCategory] = useMutation(UpsertCategoryMutation);
  const [, upsertItem] = useMutation(UpsertItemMutation);
  const [, setAvailability] = useMutation(SetAvailabilityMutation);
  const [, deleteItem] = useMutation(DeleteItemMutation);
  const [, setItemPhoto] = useMutation(SetItemPhotoMutation);
  const [publishState, publish] = useMutation(PublishMutation);
  const [, updateLayout] = useMutation(UpdateLayoutMutation);
  const [, upsertCombo] = useMutation(UpsertComboMutation);
  const [, deleteCombo] = useMutation(DeleteComboMutation);
  const [, setComboAvailability] = useMutation(SetComboAvailabilityMutation);
  const [, addComboItem] = useMutation(AddComboItemMutation);
  const [, removeComboItem] = useMutation(RemoveComboItemMutation);

  const [editing, setEditing] = useState<ItemDraft | null>(null);
  const [editingCombo, setEditingCombo] = useState<ComboDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  if (!restaurant || !branch) {
    return fetching ? (
      <Skeleton className="h-64 rounded-2xl" />
    ) : (
      <p className="text-kd-fg-muted">Complete onboarding first.</p>
    );
  }
  // Owner-only surface (#204): staff run the order board, not the menu. Block direct URL
  // access, not just the sidebar link.
  if (!isOwner)
    return <p className="text-kd-fg-muted">Only the restaurant owner can manage the menu.</p>;

  const menu = data?.draftMenu;
  const refresh = () => refetch({ requestPolicy: "network-only" });

  // The live draft row for the item currently open in the dialog. Modifier
  // groups and the photo are keyed off the persisted id, so they only appear
  // once the item has been saved to the draft.
  const editingItem = editing?.id
    ? menu?.categories.flatMap((c) => c.items).find((i) => i.id === editing.id)
    : undefined;

  // The live draft combo open in the dialog (its component list is keyed off the id, so
  // items can only be added once the combo has been saved). All draft items feed the
  // "add item" picker.
  const editingComboRow = editingCombo?.id
    ? menu?.combos.find((c) => c.id === editingCombo.id)
    : undefined;
  const allDraftItems = menu?.categories.flatMap((c) => c.items) ?? [];

  async function handlePhotoUpload(menuItemId: string, file: File) {
    setMessage(null);
    setUploadingPhoto(true);
    try {
      const { assetId } = await uploadFile(client, file, "image");
      const result = await setItemPhoto({ menuItemId, mediaId: assetId });
      if (result.error) throw new Error(result.error.graphQLErrors[0]?.message ?? "Save failed");
      refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function saveItem() {
    if (!editing || !branch) return;
    const priceMinor = Math.round(Number(editing.priceRs) * 100);
    // Item-level offer (#53): blank clears the offer (null); a value is validated
    // server-side to be strictly greater than priceMinor.
    const compareRs = Number(editing.compareAtRs);
    const compareAtPriceMinor =
      editing.compareAtRs.trim() && compareRs > 0 ? Math.round(compareRs * 100) : null;
    const result = await upsertItem({
      branchId: branch.id,
      categoryId: editing.categoryId,
      id: editing.id,
      name: editing.name,
      description: editing.description || undefined,
      priceMinor,
      compareAtPriceMinor,
    });
    if (result.error) {
      setMessage(result.error.graphQLErrors[0]?.message ?? "Save failed");
      return;
    }
    setEditing(null);
    refresh();
  }

  async function saveCombo() {
    if (!editingCombo || !branch) return;
    const priceMinor = Math.round(Number(editingCombo.priceRs) * 100);
    const result = await upsertCombo({
      branchId: branch.id,
      id: editingCombo.id,
      name: editingCombo.name,
      description: editingCombo.description || undefined,
      priceMinor,
    });
    if (result.error) {
      setMessage(result.error.graphQLErrors[0]?.message ?? "Save failed");
      return;
    }
    // Keep the editor open on the persisted combo so components can be added.
    const newId = result.data?.upsertCombo?.id;
    if (newId) setEditingCombo({ ...editingCombo, id: newId });
    refresh();
  }

  return (
    <main className="max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Menu manager</h1>
          {menu && (
            <p className="text-sm text-kd-fg-muted">
              Editing draft v{menu.version} — customers see the last published version.{" "}
              <a href="/restaurant/menu/import" className="underline">
                Upload your physical menu →
              </a>
            </p>
          )}
        </div>
        <Button
          disabled={publishState.fetching}
          onClick={async () => {
            const r = await publish({ branchId: branch.id });
            setMessage(
              r.error
                ? (r.error.graphQLErrors[0]?.message ?? "Publish failed")
                : `Published v${r.data?.publishMenu?.version} — live for customers now.`,
            );
            refresh();
          }}
        >
          {publishState.fetching ? "Publishing…" : "Publish menu"}
        </Button>
      </div>

      {message && (
        <p className="mb-4 rounded-lg bg-kd-surface-muted px-3 py-2 text-sm text-kd-fg-muted">
          {message}
        </p>
      )}

      {menu?.categories.map((cat) => (
        <section key={cat.id} className="mb-6 rounded-xl border border-kd-border bg-kd-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{cat.name}</h2>
            <div className="flex items-center gap-2">
              <select
                title="How customers see this section"
                className="rounded-lg border border-kd-border px-2 py-1 text-xs"
                value={
                  ((menu?.layoutJson as { displayModes?: Record<string, string> })?.displayModes?.[
                    cat.name
                  ] as string) ?? "list"
                }
                onChange={async (e) => {
                  const current = (menu?.layoutJson ?? {}) as {
                    categoryOrder?: string[];
                    displayModes?: Record<string, string>;
                  };
                  await updateLayout({
                    branchId: branch.id,
                    layoutJson: {
                      ...current,
                      displayModes: { ...(current.displayModes ?? {}), [cat.name]: e.target.value },
                    },
                  });
                  refresh();
                }}
              >
                {DISPLAY_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m} view
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  setEditing({
                    categoryId: cat.id,
                    name: "",
                    description: "",
                    priceRs: "",
                    compareAtRs: "",
                  })
                }
              >
                + Add item
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {cat.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-kd-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium">{item.name}</span>{" "}
                  <span className="text-kd-fg-muted">{formatRs(item.priceMinor)}</span>
                  {!item.isAvailable && (
                    <Badge variant="secondary" className="ml-2">
                      Unavailable
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setEditing({
                        id: item.id,
                        categoryId: cat.id,
                        name: item.name,
                        description: item.description ?? "",
                        priceRs: String(item.priceMinor / 100),
                        compareAtRs: item.compareAtPriceMinor
                          ? String(item.compareAtPriceMinor / 100)
                          : "",
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      await setAvailability({ itemId: item.id, available: !item.isAvailable });
                      refresh();
                    }}
                  >
                    {item.isAvailable ? "86 it" : "Restock"}
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-kd-danger"
                    onClick={async () => {
                      if (confirm(`Delete '${item.name}' from the draft?`)) {
                        await deleteItem({ itemId: item.id });
                        refresh();
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {cat.items.length === 0 && <p className="text-xs text-kd-fg-subtle">No items yet.</p>}
          </div>
        </section>
      ))}

      <Button
        variant="outline"
        onClick={async () => {
          const name = prompt("New category name:");
          if (name?.trim()) {
            await upsertCategory({ branchId: branch.id, name });
            refresh();
          }
        }}
      >
        + Add category
      </Button>

      {/* Combos / meal deals (#53). Draft-scoped; publish with the menu. */}
      <section className="mt-8 rounded-xl border border-kd-border bg-kd-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Deals &amp; combos</h2>
            <p className="text-xs text-kd-fg-muted">
              Bundle items at one price — shown in a &ldquo;Deals&rdquo; section on your page.
            </p>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => setEditingCombo({ name: "", description: "", priceRs: "" })}
          >
            + New deal
          </Button>
        </div>
        <div className="space-y-2">
          {(menu?.combos ?? []).map((combo) => (
            <div
              key={combo.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-kd-border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{combo.name}</span>{" "}
                <span className="text-kd-fg-muted">{formatRs(combo.priceMinor)}</span>{" "}
                {combo.originalPriceMinor > combo.priceMinor && (
                  <span className="text-xs text-kd-fg-subtle line-through">
                    {formatRs(combo.originalPriceMinor)}
                  </span>
                )}
                <span className="ml-2 text-xs text-kd-fg-subtle">
                  {combo.items.length} item{combo.items.length === 1 ? "" : "s"}
                </span>
                {!combo.isAvailable && (
                  <Badge variant="secondary" className="ml-2">
                    Unavailable
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    setEditingCombo({
                      id: combo.id,
                      name: combo.name,
                      description: combo.description ?? "",
                      priceRs: String(combo.priceMinor / 100),
                    })
                  }
                >
                  Edit
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    await setComboAvailability({
                      comboId: combo.id,
                      available: !combo.isAvailable,
                    });
                    refresh();
                  }}
                >
                  {combo.isAvailable ? "Hide" : "Show"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-kd-danger"
                  onClick={async () => {
                    if (confirm(`Delete deal '${combo.name}'?`)) {
                      await deleteCombo({ comboId: combo.id });
                      refresh();
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {(menu?.combos ?? []).length === 0 && (
            <p className="text-xs text-kd-fg-subtle">No deals yet.</p>
          )}
        </div>
      </section>

      {editing && (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editing.id ? "Edit item" : "New item"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Price (Rs)</Label>
                <Input
                  inputMode="decimal"
                  value={editing.priceRs}
                  onChange={(e) => setEditing({ ...editing, priceRs: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Original price (Rs) — optional</Label>
                <Input
                  inputMode="decimal"
                  placeholder="Was e.g. 800 (leave blank for no offer)"
                  value={editing.compareAtRs}
                  onChange={(e) => setEditing({ ...editing, compareAtRs: e.target.value })}
                  className="mt-1"
                />
                <p className="mt-1 text-xs text-kd-fg-subtle">
                  Set higher than the price to show a strike-through and a % off badge.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={saveItem}
                disabled={!editing.name || !Number(editing.priceRs)}
              >
                Save to draft
              </Button>

              {editingItem ? (
                <>
                  <div className="border-t border-kd-border pt-3">
                    <Label>Photo</Label>
                    <div className="mt-1 flex items-center gap-3">
                      {editingItem.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={editingItem.imageUrl}
                          alt={editingItem.name}
                          className="h-16 w-16 shrink-0 rounded-lg border border-kd-border object-cover"
                        />
                      ) : (
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-kd-border text-xs text-kd-fg-subtle">
                          None
                        </div>
                      )}
                      <div className="flex flex-col gap-1">
                        <input
                          id="menu-item-photo"
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file && editing.id) handlePhotoUpload(editing.id, file);
                            e.target.value = "";
                          }}
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={uploadingPhoto}
                          onClick={() => document.getElementById("menu-item-photo")?.click()}
                        >
                          {uploadingPhoto
                            ? "Uploading…"
                            : editingItem.imageUrl
                              ? "Replace"
                              : "Upload"}
                        </Button>
                        {editingItem.imageUrl && (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="text-kd-danger"
                            disabled={uploadingPhoto}
                            onClick={async () => {
                              if (!editing.id) return;
                              await setItemPhoto({ menuItemId: editing.id, mediaId: null });
                              refresh();
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-kd-border pt-3">
                    <ModifierGroupsEditor
                      branchId={branch.id}
                      itemId={editingItem.id}
                      groups={editingItem.modifierGroups as ModifierGroupShape[]}
                      onChange={refresh}
                    />
                  </div>
                </>
              ) : (
                <p className="border-t border-kd-border pt-3 text-xs text-kd-fg-subtle">
                  Save the item first to add a photo and modifier groups.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {editingCombo && (
        <Dialog open onOpenChange={(o) => !o && setEditingCombo(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCombo.id ? "Edit deal" : "New deal"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={editingCombo.name}
                  onChange={(e) => setEditingCombo({ ...editingCombo, name: e.target.value })}
                  className="mt-1"
                  placeholder="e.g. Burger + Fries + Drink"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={editingCombo.description}
                  onChange={(e) =>
                    setEditingCombo({ ...editingCombo, description: e.target.value })
                  }
                  rows={2}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Bundle price (Rs)</Label>
                <Input
                  inputMode="decimal"
                  value={editingCombo.priceRs}
                  onChange={(e) => setEditingCombo({ ...editingCombo, priceRs: e.target.value })}
                  className="mt-1"
                />
              </div>
              <Button
                className="w-full"
                onClick={saveCombo}
                disabled={!editingCombo.name || !Number(editingCombo.priceRs)}
              >
                Save to draft
              </Button>

              {editingComboRow ? (
                <div className="border-t border-kd-border pt-3">
                  <Label>Items in this deal</Label>
                  <div className="mt-1 space-y-1">
                    {editingComboRow.items.map((ci) => (
                      <div
                        key={ci.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-kd-border px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {ci.menuItem.name}
                          {ci.qty > 1 ? ` ×${ci.qty}` : ""}
                        </span>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-kd-danger"
                          onClick={async () => {
                            await removeComboItem({ comboItemId: ci.id });
                            refresh();
                          }}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    {editingComboRow.items.length === 0 && (
                      <p className="text-xs text-kd-fg-subtle">No items yet — add some below.</p>
                    )}
                  </div>
                  <div className="mt-3">
                    <Label>Add an item</Label>
                    <select
                      className="mt-1 w-full rounded-lg border border-kd-border px-2 py-2 text-sm"
                      value=""
                      onChange={async (e) => {
                        if (!e.target.value || !editingCombo.id) return;
                        await addComboItem({
                          comboId: editingCombo.id,
                          menuItemId: e.target.value,
                        });
                        e.target.value = "";
                        refresh();
                      }}
                    >
                      <option value="">Choose an item…</option>
                      {allDraftItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} — {formatRs(it.priceMinor)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <p className="border-t border-kd-border pt-3 text-xs text-kd-fg-subtle">
                  Save the deal first, then add items to it.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
