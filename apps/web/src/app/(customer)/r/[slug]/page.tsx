"use client";

// Branded restaurant experience: the RestaurantTheme drives CSS variables, font,
// parallax/depth hero, and card style (flat / glass / pointer-tracked tilt3d).
// Menu.layoutJson controls per-category display modes so the digital menu mirrors
// the restaurant's physical menu structure. On top of that we layer the Foodpanda
// conversion patterns (UX-03): a "Popular" auto-section, in-menu search, a scroll-
// synced category rail, a collapsing hero, one-tap quick-add, and a floating cart bar.
import { use, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
import { ItemModal, type MenuItemForModal } from "./item-modal";
import { ItemCard, type ItemForCard } from "./item-card";
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
        categories {
          id
          name
          description
          items {
            id
            name
            description
            priceMinor
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

export default function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [{ data, fetching }] = useQuery({ query: BranchQuery, variables: { slug } });
  const reduced = useReducedMotion();
  const [openItem, setOpenItem] = useState<MenuItemForModal | null>(null);
  const [conflict, setConflict] = useState<ItemForCard | null>(null);
  const [search, setSearch] = useState("");

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

  const activeId = useScrollSpy(visibleSections.map((s) => s.domId));

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
  const navSections: NavSection[] = visibleSections.map((s) => ({ domId: s.domId, name: s.name }));

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

      {visibleSections.length === 0 ? (
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
                  />
                ))}
              </div>
            </motion.section>
          );
        })
      )}

      <CartBarSpacer branchId={branch.id} />
      <FloatingCartBar branchId={branch.id} />

      {openItem && (
        <ItemModal
          item={openItem}
          branch={{ id: branch.id, slug: r.slug, name: r.name }}
          onClose={() => setOpenItem(null)}
        />
      )}

      {conflict && (
        <Dialog open onOpenChange={(open) => !open && setConflict(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Start a new cart?</DialogTitle>
              <DialogDescription>
                Your cart has items from another restaurant. Adding {conflict.name} will clear it.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => quickAdd(conflict, true)}>
                Clear cart & add
              </Button>
              <Button variant="outline" onClick={() => setConflict(null)}>
                Keep cart
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
