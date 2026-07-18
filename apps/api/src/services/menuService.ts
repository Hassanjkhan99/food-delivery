// Menu draft/publish lifecycle. The draft is edited in place; publish deep-clones it
// into a new immutable published version and repoints branch.activeMenuId. Orders are
// insulated via OrderItem.menuSnapshotJson, so old versions can be archived freely.
import { prisma } from "@fd/db";
import { GraphQLError } from "graphql";

/** Get the branch's draft menu, creating one (cloned from the active menu) if missing. */
export async function ensureDraft(branchId: string) {
  const existing = await prisma.menu.findFirst({
    where: { branchId, status: "draft" },
    orderBy: { version: "desc" },
  });
  if (existing) return existing;

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  const maxVersion = await prisma.menu.aggregate({
    where: { branchId },
    _max: { version: true },
  });
  const nextVersion = (maxVersion._max.version ?? 0) + 1;

  if (!branch.activeMenuId) {
    return prisma.menu.create({
      data: { branchId, version: nextVersion, status: "draft", layoutJson: {} },
    });
  }
  return cloneMenu(branch.activeMenuId, { status: "draft", version: nextVersion });
}

/** Deep-clone a menu (categories, items, groups, options, item<->group joins) in one tx. */
export async function cloneMenu(
  sourceMenuId: string,
  target: { status: "draft" | "published"; version: number },
) {
  const source = await prisma.menu.findUniqueOrThrow({
    where: { id: sourceMenuId },
    include: {
      categories: { include: { items: { include: { modGroups: true } } } },
      modGroups: { include: { options: true } },
      combos: { include: { items: true } },
    },
  });

  return prisma.$transaction(async (tx) => {
    const menu = await tx.menu.create({
      data: {
        branchId: source.branchId,
        version: target.version,
        status: target.status,
        layoutJson: source.layoutJson as never,
        publishedAt: target.status === "published" ? new Date() : null,
      },
    });

    // groups first (items reference them through the join table)
    const groupIdMap = new Map<string, string>();
    for (const g of source.modGroups) {
      const created = await tx.modifierGroup.create({
        data: {
          menuId: menu.id,
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          options: {
            create: g.options.map((o) => ({
              name: o.name,
              priceDeltaMinor: o.priceDeltaMinor,
              isAvailable: o.isAvailable,
              sortOrder: o.sortOrder,
            })),
          },
        },
      });
      groupIdMap.set(g.id, created.id);
    }

    // Map old item id -> cloned item id so combos can be repointed at the new rows.
    const itemIdMap = new Map<string, string>();
    for (const cat of source.categories) {
      const createdCat = await tx.menuCategory.create({
        data: {
          menuId: menu.id,
          name: cat.name,
          description: cat.description,
          sortOrder: cat.sortOrder,
          headerImageAssetId: cat.headerImageAssetId,
        },
      });
      for (const item of cat.items) {
        const createdItem = await tx.menuItem.create({
          data: {
            categoryId: createdCat.id,
            name: item.name,
            description: item.description,
            priceMinor: item.priceMinor,
            compareAtPriceMinor: item.compareAtPriceMinor,
            isAvailable: item.isAvailable,
            // Carry the timed-86 expiry across clone/publish (Codex #215/#210) — else a
            // temporarily-unavailable item copies isAvailable=false with no re-arm time and
            // stays 86'd forever after the next publish.
            unavailableUntil: item.unavailableUntil,
            imageAssetId: item.imageAssetId,
            badges: item.badges,
            // Copy dietary/allergen tags on clone (Codex #231) — else draft-create or
            // publish would silently reset them to [] and the customer chips vanish.
            dietaryTags: item.dietaryTags,
            sortOrder: item.sortOrder,
          },
        });
        itemIdMap.set(item.id, createdItem.id);
        for (const join of item.modGroups) {
          const mappedGroup = groupIdMap.get(join.groupId);
          if (mappedGroup) {
            await tx.menuItemModifierGroup.create({
              data: { itemId: createdItem.id, groupId: mappedGroup, sortOrder: join.sortOrder },
            });
          }
        }
      }
    }

    // Combos (#53): clone the bundle + its components, repointing each component at the
    // freshly-cloned MenuItem. A component whose item didn't clone (shouldn't happen —
    // combos only reference items in the same menu) is dropped defensively.
    for (const combo of source.combos) {
      const createdCombo = await tx.combo.create({
        data: {
          menuId: menu.id,
          name: combo.name,
          description: combo.description,
          priceMinor: combo.priceMinor,
          isAvailable: combo.isAvailable,
          imageAssetId: combo.imageAssetId,
          sortOrder: combo.sortOrder,
        },
      });
      for (const ci of combo.items) {
        const mappedItem = itemIdMap.get(ci.menuItemId);
        if (mappedItem) {
          await tx.comboItem.create({
            data: {
              comboId: createdCombo.id,
              menuItemId: mappedItem,
              qty: ci.qty,
              sortOrder: ci.sortOrder,
            },
          });
        }
      }
    }
    return menu;
  });
}

/** Publish the branch draft: clone -> published vNext, repoint activeMenuId, archive prior. */
export async function publishDraft(branchId: string) {
  const draft = await prisma.menu.findFirst({ where: { branchId, status: "draft" } });
  if (!draft)
    throw new GraphQLError("There's no draft menu to publish.", {
      extensions: { code: "not_found" },
    });

  const hasItems = await prisma.menuItem.count({ where: { category: { menuId: draft.id } } });
  if (hasItems === 0)
    throw new GraphQLError("Add at least one item to your draft menu before publishing.", {
      extensions: { code: "invalid_state" },
    });

  const maxVersion = await prisma.menu.aggregate({ where: { branchId }, _max: { version: true } });
  const published = await cloneMenu(draft.id, {
    status: "published",
    version: (maxVersion._max.version ?? 0) + 1,
  });

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
  await prisma.$transaction(async (tx) => {
    if (branch.activeMenuId) {
      await tx.menu.update({ where: { id: branch.activeMenuId }, data: { status: "archived" } });
    }
    await tx.branch.update({ where: { id: branchId }, data: { activeMenuId: published.id } });
  });
  return published;
}
