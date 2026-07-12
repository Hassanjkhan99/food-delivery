"use client";

// Branded restaurant experience: the RestaurantTheme drives CSS variables, font,
// parallax/depth hero, and card style (flat / glass / pointer-tracked tilt3d).
// Menu.layoutJson controls per-category display modes so the digital menu mirrors
// the restaurant's physical menu structure. On top of that we layer the Foodpanda
// conversion patterns (UX-03): a "Popular" auto-section, in-menu search, a scroll-
// synced category rail, a collapsing hero, one-tap quick-add, and a floating cart bar.
import { Suspense, use, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "urql";
import { motion, useReducedMotion } from "framer-motion";
import { Star, Timer } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ParallaxHero } from "@/components/theme/ParallaxHero";
import { DEFAULT_THEME, themeVars, type ThemeShape } from "@/components/theme/theme";
import { useCart } from "@/lib/cart";
import { ItemModal, type EditContext, type MenuItemForModal } from "./item-modal";
import { itemImagePlaceholder } from "@/components/media/placeholders";
import { ItemCard, percentOff, type ItemForCard } from "./item-card";
import { ComboCard, type ComboForCard } from "./combo-card";
import { MenuNav, type NavSection } from "./menu-nav";
import { CartBarSpacer, FloatingCartBar } from "./floating-cart-bar";
import { useHeroCollapsed, useScrollSpy } from "./use-menu-scroll";

const BranchQuery = graphql(`
  query BranchDetail($slug: String!) {
    branchBySlug(slug: $slug) {
      id
      name
      addressText
      minOrderMinor
      deliveryFeeMinor
      isAcceptingOrders
      isOpenNow
      opensAtLabel
      restaurant {
        id
        name
        slug
        avgRating
        ratingCount
        cuisineTags
        theme {
          primaryColor
          accentColor
          backgroundColor
          textColor
          fontKey
          cardStyle
          heroEffect
          logoUrl
          heroUrl
        }
      }
      popularItems {
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
          options {
            id
            name
            priceDeltaMinor
            isAvailable
          }
        }
      }
      activeMenu {
        id
        layoutJson
        combos {
          id
          name
          description
          priceMinor
          originalPriceMinor
          isAvailable
          imageUrl
          items {
            id
            qty
            menuItem {
              id
              name
              isAvailable
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
  }
`);

type LayoutJson = { categoryOrder?: string[]; displayModes?: Record<string, string> };
type Section = { domId: string; name: string; description?: string | null; items: ItemForCard[] };

function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepLinkItemId = searchParams.get("item");
  const editLineId = searchParams.get("edit");
  const [{ data, fetching }] = useQuery({ query: BranchQuery, variables: { slug } });
  const reduced = useReducedMotion();
  const [openItem, setOpenItem] = useState<MenuItemForModal | null>(null);
  const [conflict, setConflict] = useState<ItemForCard | null>(null);
  const [search, setSearch] = useState("");
  // Which ?item= deep-link we've already auto-opened, so closing the sheet doesn't
  // immediately reopen it and a param change opens the new one exactly once. State
  // (not a ref) so it's readable/settable during render per React's "adjust state on
  // prop change" pattern.
  const [openedDeepLink, setOpenedDeepLink] = useState<string | null>(null);
  // When a combo triggers the branch-conflict dialog we stash it here so "Clear & add"
  // re-adds the combo (not a menu item) after clearing the other restaurant's cart.
  const pendingCombo = useRef<ComboForCard | null>(null);

  const addLine = useCart((s) => s.addLine);
  const clearCart = useCart((s) => s.clear);
  const { ref: heroSentinel, collapsed } = useHeroCollapsed<HTMLDivElement>();

  const branch = data?.branchBySlug;
  const theme: ThemeShape = useMemo(
    () => ({ ...DEFAULT_THEME, ...(branch?.restaurant.theme ?? {}) }) as ThemeShape,
    [branch],
  );
  const layout = (branch?.activeMenu?.layoutJson ?? {}) as LayoutJson;

  // Ordered category list (honors layoutJson.categoryOrder), then the full section
  // list with the computed "Popular" pseudo-section pinned first.
  const sections = useMemo<Section[]>(() => {
    if (!branch) return [];
    const cats = [...(branch.activeMenu?.categories ?? [])];
    if (layout.categoryOrder) {
      const rank = new Map(layout.categoryOrder.map((n, i) => [n, i]));
      cats.sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));
    }
    const real: Section[] = cats.map((c) => ({
      domId: `cat-${c.id}`,
      name: c.name,
      description: c.description,
      items: c.items as ItemForCard[],
    }));
    const popular = branch.popularItems as ItemForCard[];
    return popular.length > 0
      ? [{ domId: "cat-popular", name: "Popular", items: popular }, ...real]
      : real;
  }, [branch, layout.categoryOrder]);

  // Deep-link (#37): /r/[slug]?item=<id> auto-opens that item's sheet once the menu
  // loads. We adjust state during render (guarded by a ref) rather than in an effect,
  // per React's "adjust state on prop change" guidance — so it fires exactly once per
  // id and closing the sheet doesn't reopen it. Search the real categories (source of
  // truth) so it works even when the item isn't in the computed "Popular" section; a
  // missing/stale id simply no-ops. Unavailable items are skipped — a stale/direct
  // deep-link must never surface an orderable sheet the normal ItemCard would disable
  // (branch closed/paused is handled separately by passing `orderable` to the modal).
  if (deepLinkItemId && branch && openedDeepLink !== deepLinkItemId) {
    setOpenedDeepLink(deepLinkItemId);
    for (const cat of branch.activeMenu?.categories ?? []) {
      const found = cat.items.find((i) => i.id === deepLinkItemId);
      if (found) {
        if (found.isAvailable) setOpenItem(found as MenuItemForModal);
        break;
      }
    }
  }

  // Deals (#53): combos + any discounted items, aggregated into a pseudo-section pinned
  // above Popular. Combos come from the active menu; discounted items are scanned out of
  // the real categories (deduped, available only). Guarded so a missing menu can't crash.
  const combos = useMemo<ComboForCard[]>(
    () =>
      (branch?.activeMenu?.combos ?? []).filter(
        // Hide a combo if it's unavailable OR any of its component items is unavailable —
        // quoteCart rejects such combos server-side, so showing them as addable would only
        // surface the failure at checkout.
        (c) => c.isAvailable && c.items.every((ci) => ci.menuItem.isAvailable),
      ) as ComboForCard[],
    [branch],
  );
  const discountedItems = useMemo<ItemForCard[]>(() => {
    const cats = branch?.activeMenu?.categories ?? [];
    const seen = new Set<string>();
    const out: ItemForCard[] = [];
    for (const c of cats) {
      for (const it of c.items as ItemForCard[]) {
        if (it.isAvailable && percentOff(it) != null && !seen.has(it.id)) {
          seen.add(it.id);
          out.push(it);
        }
      }
    }
    return out;
  }, [branch]);
  const hasDeals = combos.length > 0 || discountedItems.length > 0;

  // Client-side in-menu search. Popular is hidden while searching so items don't
  // appear twice (once under Popular, once under their real category).
  const q = search.trim().toLowerCase();
  const visibleSections = useMemo<Section[]>(() => {
    if (!q) return sections;
    return sections
      .filter((s) => s.domId !== "cat-popular")
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [sections, q]);

  const activeId = useScrollSpy([
    ...(hasDeals && !q ? ["cat-deals"] : []),
    ...visibleSections.map((s) => s.domId),
  ]);

  // Edit-from-cart round-trip (#39): /r/[slug]?edit=<lineId>. We hold the item's
  // modifier groups here, so we derive the line's item from the loaded menu and
  // open the sheet pre-filled. Derived (not effect state) so it can't cascade.
  const cartLines = useCart((s) => s.lines);
  const [dismissedEdit, setDismissedEdit] = useState<string | null>(null);
  const editTarget = useMemo(() => {
    if (!editLineId || editLineId === dismissedEdit) return null;
    const line = cartLines.find((l) => l.lineId === editLineId);
    if (!line) return null;
    const item = sections.flatMap((s) => s.items).find((i) => i.id === line.menuItemId);
    if (!item) return null;
    return {
      item,
      edit: {
        lineId: line.lineId,
        qty: line.qty,
        modifierOptionIds: line.modifierOptionIds,
        notes: line.notes,
        unavailabilityPreference: line.unavailabilityPreference,
      } satisfies EditContext,
    };
  }, [editLineId, dismissedEdit, cartLines, sections]);

  // Closing the edit sheet: strip the ?edit param and remember the id so this
  // render pass doesn't immediately re-derive it back open. Event handler → the
  // setState here is fine (not an effect).
  function closeEdit() {
    if (editLineId) setDismissedEdit(editLineId);
    router.replace(`/r/${slug}`);
  }

  if (fetching) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!branch) return <p className="text-kd-fg-muted">Restaurant not found.</p>;

  const r = branch.restaurant;
  const reviewsHref = `/r/${r.slug}/reviews`;
  // Cuisine-aware dish placeholder for items without their own photo (else gradient tile).
  const itemFallback = itemImagePlaceholder(r.cuisineTags);
  // Deals is pinned first in the rail (hidden while searching, matching Popular's behaviour).
  const showDeals = hasDeals && !q;
  const navSections: NavSection[] = [
    ...(showDeals ? [{ domId: "cat-deals", name: "Deals" }] : []),
    ...visibleSections.map((s) => ({ domId: s.domId, name: s.name })),
  ];

  // Closed-by-hours (or paused) → don't let the customer build a cart we can't fulfil.
  // isOpenNow already folds in the branch's published hours; !isAcceptingOrders is the
  // manual pause. Either one blocks quick-add / add-to-cart via `orderable` below.
  const closedByHours = !branch.isOpenNow;
  const orderable = branch.isAcceptingOrders && !closedByHours;
  const closedLabel = closedByHours
    ? branch.opensAtLabel
      ? `Closed now · opens ${branch.opensAtLabel}`
      : "Closed now"
    : "Temporarily paused";

  function quickAdd(item: ItemForCard, clearFirst = false) {
    // Hard guard: never build a cart for a closed/paused branch even if a UI path slips through.
    if (!branch || !branch.isAcceptingOrders || !branch.isOpenNow) return;
    if (clearFirst) clearCart();
    const result = addLine(
      { id: branch.id, slug: r.slug, name: r.name },
      {
        menuItemId: item.id,
        name: item.name,
        qty: 1,
        unitPriceMinor: item.priceMinor,
        modifierOptionIds: [],
        modifierNames: [],
      },
    );
    if (result === "branch_conflict") setConflict(item);
    else setConflict(null);
  }

  // Add a combo/meal deal (#53) as one cart line keyed by comboId. The server re-prices
  // and snapshots it; the client price here is just the display estimate. Branch-conflict
  // handling reuses the same dialog (we stash a synthetic ItemForCard-like shape name).
  function addCombo(combo: ComboForCard, clearFirst = false) {
    if (!branch || !branch.isAcceptingOrders || !branch.isOpenNow) return;
    if (clearFirst) clearCart();
    const result = addLine(
      { id: branch.id, slug: r.slug, name: r.name },
      {
        comboId: combo.id,
        name: combo.name,
        qty: 1,
        unitPriceMinor: combo.priceMinor,
        modifierOptionIds: [],
        modifierNames: [],
      },
    );
    if (result === "branch_conflict") {
      setConflict({ id: combo.id, name: combo.name } as ItemForCard);
      // Remember this was a combo so "Clear cart & add" re-adds correctly.
      pendingCombo.current = combo;
    } else {
      setConflict(null);
      pendingCombo.current = null;
    }
  }

  function onJump(domId: string) {
    document
      .getElementById(domId)
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }

  return (
    <main className="-mx-4 -my-6 min-h-screen px-4 py-6" style={themeVars(theme)}>
      <ParallaxHero
        effect={theme.heroEffect as "none" | "parallax" | "depth"}
        heroUrl={theme.heroUrl}
        primaryColor={theme.primaryColor}
      >
        <div>
          {theme.logoUrl && (
            <Image
              src={theme.logoUrl}
              alt=""
              width={48}
              height={48}
              // Owner-supplied logo host isn't guaranteed to be in the image
              // allowlist; skip the optimizer so any uploaded/CDN URL renders.
              unoptimized
              className="mb-2 h-12 w-12 rounded-xl object-cover shadow"
            />
          )}
          <h1
            className="text-4xl font-bold drop-shadow-sm"
            style={{ color: theme.heroUrl ? "#fff" : "var(--brand-primary)" }}
          >
            {r.name}
          </h1>
          <div
            className="mt-1 flex flex-wrap items-center gap-3 text-sm"
            style={{ color: theme.heroUrl ? "#ffffffcc" : "var(--brand-text)" }}
          >
            {r.avgRating != null && (
              <Link href={reviewsHref} className="flex items-center gap-1 hover:underline">
                <Star className="h-4 w-4 fill-kd-warning text-kd-warning" />
                {r.avgRating.toFixed(1)} ({r.ratingCount}) reviews
              </Link>
            )}
            <span className="flex items-center gap-1">
              <Timer className="h-4 w-4" /> Min {formatRs(branch.minOrderMinor)}
            </span>
            <span>Delivery {formatRs(branch.deliveryFeeMinor)}</span>
            {!orderable && <Badge variant="destructive">{closedLabel}</Badge>}
          </div>
        </div>
      </ParallaxHero>

      {/* Sentinel: once this scrolls out of view the nav shows a compact title. */}
      <div ref={heroSentinel} aria-hidden className="h-px" />

      <MenuNav
        sections={navSections}
        activeId={activeId}
        collapsed={collapsed}
        title={r.name}
        avgRating={r.avgRating}
        ratingCount={r.ratingCount}
        reviewsHref={reviewsHref}
        search={search}
        onSearch={setSearch}
        onJump={onJump}
      />

      {!orderable && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded-2xl border border-kd-danger bg-kd-danger-soft p-4"
        >
          <Timer className="mt-0.5 h-5 w-5 shrink-0 text-kd-danger" />
          <div className="text-sm">
            <p className="font-semibold text-kd-danger">{closedLabel}</p>
            <p className="opacity-70">
              {closedByHours
                ? "This restaurant is outside its opening hours. You can browse the menu, but ordering is unavailable right now."
                : "This restaurant has paused new orders. You can browse the menu, but ordering is unavailable right now."}
            </p>
          </div>
        </div>
      )}

      {showDeals && (
        <motion.section
          id="cat-deals"
          className="mb-10 scroll-mt-36"
          initial={reduced ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.45 }}
        >
          <h2 className="mb-1 text-2xl font-semibold" style={{ color: "var(--brand-primary)" }}>
            Deals
          </h2>
          <p className="mb-3 text-sm opacity-60">Meal deals and discounted picks.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {combos.map((combo) => (
              <ComboCard
                key={`combo-${combo.id}`}
                combo={combo}
                cardStyle={theme.cardStyle}
                accepting={orderable}
                onAdd={(c) => addCombo(c)}
                imageFallback={itemFallback}
              />
            ))}
            {discountedItems.map((item) => (
              <ItemCard
                key={`deal-${item.id}`}
                item={item}
                mode="list"
                cardStyle={theme.cardStyle}
                accepting={orderable}
                onOpen={(it) => setOpenItem(it)}
                onQuickAdd={(it) => quickAdd(it)}
                imageFallback={itemFallback}
              />
            ))}
          </div>
        </motion.section>
      )}

      {visibleSections.length === 0 && !showDeals ? (
        <p className="py-12 text-center text-sm opacity-60">
          No items match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        visibleSections.map((section, ci) => {
          const mode =
            section.domId === "cat-popular"
              ? "list"
              : (layout.displayModes?.[section.name] ?? "list");
          return (
            <motion.section
              key={section.domId}
              id={section.domId}
              className="mb-10 scroll-mt-36"
              initial={reduced ? false : { opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: Math.min(ci * 0.05, 0.2) }}
            >
              <h2 className="mb-1 text-2xl font-semibold" style={{ color: "var(--brand-primary)" }}>
                {section.name}
              </h2>
              {section.description && (
                <p className="mb-3 text-sm opacity-60">{section.description}</p>
              )}
              <div
                className={
                  mode === "grid"
                    ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                    : mode === "compact"
                      ? "divide-y divide-kd-border rounded-xl border border-kd-border bg-kd-surface/50"
                      : "grid gap-3 sm:grid-cols-2"
                }
              >
                {section.items.map((item) => (
                  <ItemCard
                    key={`${section.domId}-${item.id}`}
                    item={item}
                    mode={mode}
                    cardStyle={theme.cardStyle}
                    accepting={orderable}
                    onOpen={(it) => setOpenItem(it)}
                    onQuickAdd={(it) => quickAdd(it)}
                    imageFallback={itemFallback}
                  />
                ))}
              </div>
            </motion.section>
          );
        })
      )}

      <CartBarSpacer branchId={branch.id} />
      <FloatingCartBar branchId={branch.id} />

      {/* Edit-from-cart (URL param) takes precedence over a plain card open. */}
      {editTarget ? (
        <ItemModal
          key={editTarget.edit.lineId}
          item={editTarget.item}
          branch={{ id: branch.id, slug: r.slug, name: r.name }}
          orderable={orderable}
          disabledLabel={closedLabel}
          edit={editTarget.edit}
          onClose={closeEdit}
        />
      ) : (
        openItem && (
          <ItemModal
            item={openItem}
            branch={{ id: branch.id, slug: r.slug, name: r.name }}
            orderable={orderable}
            disabledLabel={closedLabel}
            onClose={() => setOpenItem(null)}
          />
        )
      )}

      {conflict && (
        <Dialog
          open
          onOpenChange={(open) => {
            // Dismissing via the close/escape/overlay path must also drop any stashed
            // combo, else a later item-conflict's "Clear cart & add" would re-add the
            // stale combo instead of the item named in the dialog.
            if (!open) {
              pendingCombo.current = null;
              setConflict(null);
            }
          }}
        >
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Start a new cart?</DialogTitle>
              <DialogDescription>
                Your cart has items from another restaurant. Adding {conflict.name} will clear it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => {
                  const combo = pendingCombo.current;
                  if (combo) addCombo(combo, true);
                  else quickAdd(conflict, true);
                }}
              >
                Clear cart & add
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  pendingCombo.current = null;
                  setConflict(null);
                }}
              >
                Keep cart
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}

// useSearchParams (for the ?edit=<lineId> round-trip) requires a Suspense boundary.
export default function RestaurantPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense>
      <RestaurantPage params={params} />
    </Suspense>
  );
}
