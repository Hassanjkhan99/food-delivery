"use client";

// Branded restaurant experience: the RestaurantTheme drives CSS variables, font,
// parallax/depth hero, and card style (flat / glass / pointer-tracked tilt3d).
// Menu.layoutJson controls per-category display modes so the digital menu mirrors
// the restaurant's physical menu structure.
import { use, useMemo, useState } from "react";
import { useQuery } from "urql";
import { motion, useReducedMotion } from "framer-motion";
import { Star, Timer } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { formatRs } from "@fd/shared";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ParallaxHero } from "@/components/theme/ParallaxHero";
import { TiltCard } from "@/components/theme/TiltCard";
import { DEFAULT_THEME, cardClasses, themeVars, type ThemeShape } from "@/components/theme/theme";
import { ItemModal, type MenuItemForModal } from "./item-modal";

const BranchQuery = graphql(`
  query BranchDetail($slug: String!) {
    branchBySlug(slug: $slug) {
      id
      name
      addressText
      minOrderMinor
      deliveryFeeMinor
      isAcceptingOrders
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

export default function RestaurantPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [{ data, fetching }] = useQuery({ query: BranchQuery, variables: { slug } });
  const [openItem, setOpenItem] = useState<MenuItemForModal | null>(null);
  const reduced = useReducedMotion();
  const branch = data?.branchBySlug;

  const theme: ThemeShape = useMemo(
    () => ({ ...DEFAULT_THEME, ...(branch?.restaurant.theme ?? {}) }) as ThemeShape,
    [branch],
  );

  const layout = (branch?.activeMenu?.layoutJson ?? {}) as LayoutJson;
  const categories = useMemo(() => {
    const cats = [...(branch?.activeMenu?.categories ?? [])];
    if (layout.categoryOrder) {
      const rank = new Map(layout.categoryOrder.map((n, i) => [n, i]));
      cats.sort((a, b) => (rank.get(a.name) ?? 99) - (rank.get(b.name) ?? 99));
    }
    return cats;
  }, [branch, layout.categoryOrder]);

  if (fetching) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-3xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!branch) return <p className="text-neutral-500">Restaurant not found.</p>;

  const r = branch.restaurant;
  const tilt = theme.cardStyle === "tilt3d";

  return (
    <main className="-mx-4 -my-6 min-h-screen px-4 py-6" style={themeVars(theme)}>
      <ParallaxHero
        effect={theme.heroEffect as "none" | "parallax" | "depth"}
        heroUrl={theme.heroUrl}
        primaryColor={theme.primaryColor}
      >
        <div>
          {theme.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" className="mb-2 h-12 w-12 rounded-xl object-cover shadow" />
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
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {r.avgRating.toFixed(1)} ({r.ratingCount})
              </span>
            )}
            <span className="flex items-center gap-1">
              <Timer className="h-4 w-4" /> Min {formatRs(branch.minOrderMinor)}
            </span>
            <span>Delivery {formatRs(branch.deliveryFeeMinor)}</span>
            {!branch.isAcceptingOrders && <Badge variant="destructive">Paused</Badge>}
          </div>
        </div>
      </ParallaxHero>

      {/* Category rail */}
      <nav className="sticky top-14 z-30 -mx-4 mb-6 overflow-x-auto px-4 py-2 backdrop-blur" style={{ backgroundColor: "color-mix(in srgb, var(--brand-bg) 85%, transparent)" }}>
        <div className="flex gap-2">
          {categories.map((c) => (
            <a
              key={c.id}
              href={`#cat-${c.id}`}
              className="whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium transition hover:scale-105"
              style={{ backgroundColor: "color-mix(in srgb, var(--brand-primary) 12%, transparent)", color: "var(--brand-primary)" }}
            >
              {c.name}
            </a>
          ))}
        </div>
      </nav>

      {categories.map((cat, ci) => {
        const mode = layout.displayModes?.[cat.name] ?? "list";
        return (
          <motion.section
            key={cat.id}
            id={`cat-${cat.id}`}
            className="mb-10 scroll-mt-28"
            initial={reduced ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: Math.min(ci * 0.05, 0.2) }}
          >
            <h2 className="mb-1 text-2xl font-semibold" style={{ color: "var(--brand-primary)" }}>
              {cat.name}
            </h2>
            {cat.description && <p className="mb-3 text-sm opacity-60">{cat.description}</p>}

            <div
              className={
                mode === "grid"
                  ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  : mode === "compact"
                    ? "divide-y divide-black/5 rounded-xl border border-black/5 bg-white/50"
                    : "grid gap-3 sm:grid-cols-2"
              }
            >
              {cat.items.map((item) => {
                const inner = (
                  <>
                    <div className="min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{item.name}</span>
                        {item.badges.map((b) => (
                          <span key={b} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "color-mix(in srgb, var(--brand-accent) 25%, transparent)" }}>
                            {b}
                          </span>
                        ))}
                      </div>
                      {mode !== "compact" && item.description && (
                        <p className="mt-1 line-clamp-2 text-sm opacity-60">{item.description}</p>
                      )}
                      {!item.isAvailable && (
                        <p className="mt-1 text-xs font-medium text-red-500">Unavailable</p>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold" style={{ color: "var(--brand-primary)" }}>
                      {formatRs(item.priceMinor)}
                    </span>
                  </>
                );
                const shared = `flex w-full items-start justify-between gap-3 p-4 text-sm disabled:opacity-50 ${
                  mode === "compact" ? "" : `rounded-2xl ${cardClasses(theme.cardStyle)}`
                }`;
                const disabled = !item.isAvailable || !branch.isAcceptingOrders;
                const onClick = () => setOpenItem(item as MenuItemForModal);

                return tilt && mode !== "compact" ? (
                  <TiltCard key={item.id} className={shared} onClick={onClick} disabled={disabled}>
                    {inner}
                  </TiltCard>
                ) : (
                  <motion.button
                    key={item.id}
                    type="button"
                    className={shared}
                    disabled={disabled}
                    onClick={onClick}
                    whileHover={reduced ? undefined : { scale: mode === "compact" ? 1 : 1.01 }}
                    whileTap={reduced ? undefined : { scale: 0.99 }}
                  >
                    {inner}
                  </motion.button>
                );
              })}
            </div>
          </motion.section>
        );
      })}

      {openItem && (
        <ItemModal
          item={openItem}
          branch={{ id: branch.id, slug: r.slug, name: r.name }}
          onClose={() => setOpenItem(null)}
        />
      )}
    </main>
  );
}
