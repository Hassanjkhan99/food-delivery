"use client";

// Per-item modifier-group editor: create/edit/delete groups (name, required,
// min/max select) and their options (name, price delta) via the modifier CRUD
// mutations. Mirrors the draft-editing UX of the menu manager page.
import { useState } from "react";
import { useMutation } from "urql";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const UpsertGroupMutation = graphql(`
  mutation UpsertModifierGroup(
    $branchId: String!
    $id: String
    $itemId: String
    $name: String!
    $minSelect: Int!
    $maxSelect: Int!
  ) {
    upsertModifierGroup(
      branchId: $branchId
      id: $id
      itemId: $itemId
      name: $name
      minSelect: $minSelect
      maxSelect: $maxSelect
    ) {
      id
    }
  }
`);
const DeleteGroupMutation = graphql(`
  mutation DeleteModifierGroup($id: String!) {
    deleteModifierGroup(id: $id)
  }
`);
const UpsertOptionMutation = graphql(`
  mutation UpsertModifierOption(
    $groupId: String!
    $id: String
    $name: String!
    $priceDeltaMinor: Int!
  ) {
    upsertModifierOption(
      groupId: $groupId
      id: $id
      name: $name
      priceDeltaMinor: $priceDeltaMinor
    ) {
      id
    }
  }
`);
const DeleteOptionMutation = graphql(`
  mutation DeleteModifierOption($id: String!) {
    deleteModifierOption(id: $id)
  }
`);

type OptionShape = { id: string; name: string; priceDeltaMinor: number };
type GroupShape = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: OptionShape[];
};

type GroupDraft = {
  id?: string;
  name: string;
  required: boolean;
  minSelect: string;
  maxSelect: string;
};

type OptionDraft = {
  id?: string;
  groupId: string;
  name: string;
  priceRs: string;
};

export function ModifierGroupsEditor({
  branchId,
  itemId,
  groups,
  onChange,
}: {
  branchId: string;
  itemId: string;
  groups: GroupShape[];
  onChange: () => void;
}) {
  const [, upsertGroup] = useMutation(UpsertGroupMutation);
  const [, deleteGroup] = useMutation(DeleteGroupMutation);
  const [, upsertOption] = useMutation(UpsertOptionMutation);
  const [, deleteOption] = useMutation(DeleteOptionMutation);

  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveGroup() {
    if (!groupDraft) return;
    const minSelect = groupDraft.required ? Math.max(1, Number(groupDraft.minSelect) || 1) : 0;
    const maxSelect = Math.max(minSelect || 1, Number(groupDraft.maxSelect) || 1);
    const result = await upsertGroup({
      branchId,
      id: groupDraft.id,
      itemId: groupDraft.id ? undefined : itemId, // link on create only
      name: groupDraft.name,
      minSelect,
      maxSelect,
    });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Save failed");
      return;
    }
    setGroupDraft(null);
    setError(null);
    onChange();
  }

  async function saveOption() {
    if (!optionDraft) return;
    const priceDeltaMinor = Math.round(Number(optionDraft.priceRs || "0") * 100);
    const result = await upsertOption({
      groupId: optionDraft.groupId,
      id: optionDraft.id,
      name: optionDraft.name,
      priceDeltaMinor,
    });
    if (result.error) {
      setError(result.error.graphQLErrors[0]?.message ?? "Save failed");
      return;
    }
    setOptionDraft(null);
    setError(null);
    onChange();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Modifier groups</Label>
        <Button
          size="xs"
          variant="outline"
          onClick={() =>
            setGroupDraft({ name: "", required: false, minSelect: "0", maxSelect: "1" })
          }
        >
          + Add group
        </Button>
      </div>

      {error && <p className="text-xs text-kd-danger">{error}</p>}

      {groups.length === 0 && (
        <p className="text-xs text-kd-fg-subtle">
          No modifier groups yet (e.g. &ldquo;Size&rdquo;, &ldquo;Add-ons&rdquo;).
        </p>
      )}

      {groups.map((group) => (
        <div key={group.id} className="rounded-lg border border-kd-border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="font-medium">{group.name}</span>
              {group.required ? (
                <Badge variant="secondary" className="ml-2">
                  Required
                </Badge>
              ) : (
                <Badge variant="outline" className="ml-2">
                  Optional
                </Badge>
              )}
              <span className="ml-2 text-xs text-kd-fg-muted">
                choose {group.minSelect}–{group.maxSelect}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  setGroupDraft({
                    id: group.id,
                    name: group.name,
                    required: group.required,
                    minSelect: String(group.minSelect),
                    maxSelect: String(group.maxSelect),
                  })
                }
              >
                Edit
              </Button>
              <Button
                size="xs"
                variant="ghost"
                className="text-kd-danger"
                onClick={async () => {
                  if (confirm(`Delete group '${group.name}'?`)) {
                    await deleteGroup({ id: group.id });
                    onChange();
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>

          <div className="mt-2 space-y-1">
            {group.options.map((opt) => (
              <div
                key={opt.id}
                className="flex items-center justify-between gap-2 rounded-md bg-kd-surface-muted px-2 py-1 text-xs"
              >
                <span className="min-w-0">
                  {opt.name}
                  {opt.priceDeltaMinor !== 0 && (
                    <span className="ml-1 text-kd-fg-muted">+{formatRs(opt.priceDeltaMinor)}</span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setOptionDraft({
                        id: opt.id,
                        groupId: group.id,
                        name: opt.name,
                        priceRs: String(opt.priceDeltaMinor / 100),
                      })
                    }
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-kd-danger"
                    onClick={async () => {
                      await deleteOption({ id: opt.id });
                      onChange();
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setOptionDraft({ groupId: group.id, name: "", priceRs: "0" })}
            >
              + Add option
            </Button>
          </div>
        </div>
      ))}

      {groupDraft && (
        <Dialog open onOpenChange={(o) => !o && setGroupDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{groupDraft.id ? "Edit group" : "New group"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={groupDraft.name}
                  onChange={(e) => setGroupDraft({ ...groupDraft, name: e.target.value })}
                  placeholder="e.g. Size"
                  className="mt-1"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={groupDraft.required}
                  onChange={(e) =>
                    setGroupDraft({
                      ...groupDraft,
                      required: e.target.checked,
                      minSelect: e.target.checked
                        ? String(Math.max(1, Number(groupDraft.minSelect) || 1))
                        : "0",
                    })
                  }
                />
                Required (customer must choose)
              </label>
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label>Min select</Label>
                  <Input
                    inputMode="numeric"
                    value={groupDraft.minSelect}
                    onChange={(e) => setGroupDraft({ ...groupDraft, minSelect: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="flex-1">
                  <Label>Max select</Label>
                  <Input
                    inputMode="numeric"
                    value={groupDraft.maxSelect}
                    onChange={(e) => setGroupDraft({ ...groupDraft, maxSelect: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
              <Button className="w-full" onClick={saveGroup} disabled={!groupDraft.name.trim()}>
                Save to draft
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {optionDraft && (
        <Dialog open onOpenChange={(o) => !o && setOptionDraft(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{optionDraft.id ? "Edit option" : "New option"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={optionDraft.name}
                  onChange={(e) => setOptionDraft({ ...optionDraft, name: e.target.value })}
                  placeholder="e.g. Large"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Price delta (Rs)</Label>
                <Input
                  inputMode="decimal"
                  value={optionDraft.priceRs}
                  onChange={(e) => setOptionDraft({ ...optionDraft, priceRs: e.target.value })}
                  className="mt-1"
                />
              </div>
              <Button className="w-full" onClick={saveOption} disabled={!optionDraft.name.trim()}>
                Save to draft
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
