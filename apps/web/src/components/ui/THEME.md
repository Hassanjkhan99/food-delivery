# Herald Theme & UI Guide

The canonical maintainability guide for the theme. Migration agents and future devs
follow this doc. The design system lives in `apps/web/src/app/globals.css` (raw
`--kd-*` values in `:root`/`.dark`, mirrored into `@theme inline` so Tailwind emits
`kd-*` utilities).

**Brand (McDonald's-style, issue #48 UX-13):** cream-dominant surfaces, warm charcoal
text, **red (`#DA291C`) for primary CTAs**, **golden yellow (`#FFC72C`) as the accent**
(highlights, deals, rating star), green for success/free-delivery. Target usage ratio:
cream/white 55–65%, charcoal 15–20%, red 10–15%, yellow 5–10% — yellow is an accent, not
a background wash. No literal McDonald's assets/logos — style and energy only. The token
_names_ are still `--kd-*` (already wired into Tailwind); only their values changed.

**shadcn bridge:** the shadcn tokens (`--primary`, `--secondary`, `--destructive`,
`--background`, `--border`, `--ring`, …) are defined in terms of the `--kd-*` values in
`globals.css`, so every UI primitive (`Button`, `Card`, `Input`, `Badge`) inherits the
brand palette automatically — `<Button>` default renders red, not gray. Change a brand
value once and it cascades everywhere.

**Golden rule:** do not hand-write hex/`neutral-*`/`red-*`/etc. colors in
components. Use the `--kd-*` tokens (via their Tailwind utilities) or an existing
UI primitive. Every `--kd-*` token has a `.dark` override, so swapping neutrals to
kd tokens automatically improves dark mode.

---

## Color tokens

| Token                | Tailwind utilities                                     | Meaning                            |
| -------------------- | ------------------------------------------------------ | ---------------------------------- |
| `--kd-primary`       | `text-kd-primary` `bg-kd-primary` `border-kd-primary`  | Red brand / primary CTAs           |
| `--kd-primary-hover` | `hover:bg-kd-primary-hover`                            | Brand hover (darker red)           |
| `--kd-primary-soft`  | `bg-kd-primary-soft`                                   | Brand tint / soft surface          |
| `--kd-accent`        | `text-kd-accent` `bg-kd-accent`                        | Golden-yellow accent / rating star |
| `--kd-accent-soft`   | `bg-kd-accent-soft`                                    | Yellow tint (deal/offer chips)     |
| `--kd-overlay`       | `bg-kd-overlay`                                        | Scrim for image/closed overlays    |
| `--kd-success`       | `text-kd-success` `border-kd-success`                  | Success / positive                 |
| `--kd-success-soft`  | `bg-kd-success-soft`                                   | Success tint                       |
| `--kd-warning`       | `text-kd-warning` `border-kd-warning`                  | Warning / paused                   |
| `--kd-warning-soft`  | `bg-kd-warning-soft`                                   | Warning tint                       |
| `--kd-danger`        | `text-kd-danger` `border-kd-danger`                    | Error / destructive / negative     |
| `--kd-danger-soft`   | `bg-kd-danger-soft`                                    | Danger tint                        |
| `--kd-info`          | `text-kd-info` `border-kd-info`                        | Informational (sky/blue) — **NEW** |
| `--kd-info-soft`     | `bg-kd-info-soft`                                      | Info tint — **NEW**                |
| `--kd-bg`            | `bg-kd-bg`                                             | App background                     |
| `--kd-surface`       | `bg-kd-surface`                                        | Cards / panels / raised surfaces   |
| `--kd-surface-muted` | `bg-kd-surface-muted`                                  | Subtle / recessed surfaces         |
| `--kd-fg`            | `text-kd-fg`                                           | Primary text                       |
| `--kd-fg-muted`      | `text-kd-fg-muted`                                     | Secondary text / hints             |
| `--kd-fg-subtle`     | `text-kd-fg-subtle`                                    | Tertiary / disabled text           |
| `--kd-border`        | `border-kd-border` `divide-kd-border` `ring-kd-border` | Borders / dividers / rings         |

---

## Type scale

Semantic, opt-in font-size tokens (namespaced so they never collide with
Tailwind defaults). Each carries a paired line-height.

| Token               | Utility           | Size / line-height |
| ------------------- | ----------------- | ------------------ |
| `--text-kd-display` | `text-kd-display` | 2.25rem / 2.5rem   |
| `--text-kd-heading` | `text-kd-heading` | 1.5rem / 2rem      |
| `--text-kd-title`   | `text-kd-title`   | 1.125rem / 1.75rem |
| `--text-kd-body`    | `text-kd-body`    | 1rem / 1.5rem      |
| `--text-kd-label`   | `text-kd-label`   | 0.875rem / 1.25rem |
| `--text-kd-caption` | `text-kd-caption` | 0.75rem / 1rem     |

These are additive — nothing is restyled globally. Reach for them on new/migrated
markup instead of ad-hoc `text-2xl`/`leading-*` pairs.

---

## Color -> token mapping

> Herald token mapping (existing tokens in `apps/web/src/app/globals.css` — DO NOT add new ones unless foundation added them):
>
> STRUCTURAL NEUTRALS (warm Stone):
>
> ```
>   text-neutral-900 / text-neutral-800 / text-black  -> text-kd-fg
>   text-neutral-700 / text-neutral-600 / text-neutral-500  -> text-kd-fg-muted
>   text-neutral-400 / text-neutral-300  -> text-kd-fg-subtle
>   border-neutral-200 / border-neutral-300 / border-neutral-100  -> border-kd-border
>   bg-white  -> bg-kd-surface
>   bg-neutral-50 / bg-neutral-100  -> bg-kd-surface-muted
>   divide-neutral-200 -> divide-kd-border ; ring-neutral-* -> ring-kd-border
> ```
>
> STATUS COLORS:
>
> ```
>   amber-*  (warnings / paused / dev hints)  -> text-kd-warning / bg-kd-warning-soft / border-kd-warning
>   red-*    (errors / destructive / negative) -> text-kd-danger / bg-kd-danger-soft ; prefer <Button variant="destructive"> for buttons
>   green-* / emerald-*  (success / free delivery / positive) -> text-kd-success / bg-kd-success-soft
>   rose-*   (brand)  -> text-kd-primary / bg-kd-primary-soft / hover:bg-kd-primary-hover
>   blue-* / sky-* / indigo-* (informational) -> text-kd-info / bg-kd-info-soft   (info tokens are NEW from foundation)
> ```
>
> JUDGMENT — DO NOT blindly replace:
>
> ```
>   * Decorative/placeholder gradients (photo fallbacks, cuisine glyph tints) — KEEP as-is, report as intentional.
>   * bg-neutral-900 used as an intentional dark chrome (e.g. rider app dark header) — keep unless it is clearly a plain surface.
>   * Colors already inside a restaurant's dynamic brand theme (var(--brand-*)) — leave untouched.
> ```
>
> Every kd-* token already has a `.dark` override, so swapping neutrals to kd tokens IMPROVES dark mode.

---

## Use primitives, not inline markup

Prefer the existing UI primitives in `apps/web/src/components/ui/` over
hand-rolled markup:

- **`<Button>`** — any clickable action. Use `variant="brand"` for the primary CTA
  on a screen (Add to cart, Checkout — solid red with a darker-red hover). `default`
  also renders red via the bridge; `variant="destructive"` for delete/negative actions
  instead of `red-*` classes.
- **`<Badge>`** — status pills, counts, tags. `variant="brand"` (red, e.g. Promoted),
  `variant="accent"` (solid gold, deals), `variant="accent-soft"` (yellow tint, e.g.
  "-20%"). Use variants rather than a styled `<span>`.
- **`<Input>` / `<Textarea>`** — text entry. Do not restyle a bare `<input>`.
- **`<Card>`** — grouped/raised content on `bg-kd-surface`, instead of an
  ad-hoc `bg-white rounded border` div.
- **`<FormField>`** — labelled form controls. Wraps `<Label>` + control with
  accessible hint/error wiring (`role="alert"`, `aria-invalid`,
  `aria-describedby`). Use it instead of hand-assembling label + input + error
  text. Pass a control via `children`, or omit `children` to get a default
  `<Input>`.

### Structural primitives (build the library once)

These replace the most-duplicated inline patterns across the app. Reach for them
instead of re-implementing the markup; see all of them live on `/dev/design`.

- **`<PageHeader title description actions>`** — the `h1` + subtitle + right-side
  actions block at the top of nearly every screen.
- **`<EmptyState icon title description action surface>`** — "no … yet" / zero-result /
  not-found states. `surface`: `"card"` (default, solid), `"glass"` (frosted, over an
  ambient background), or `"bare"`.
- **`<Chip>`** (+ `chipVariants` for `<button>` call sites) — `rounded-full` pills.
  `tone`: `neutral` / `primary` / `glass`; `selected` for active filters; apply
  `chipVariants({ interactive: true, selected })` to a real `<button>` so it keeps
  native semantics + `aria-pressed`.
- **`<StatTile label value hint icon>`** — dashboard metric tile (tabular value).
- **`<ListRow leading title subtitle trailing href>`** — a summary row; renders as a
  `<Link>` when `href` is set.
- **`<Banner tone title>`** — inline alert; `tone`: `info` / `success` / `warning` /
  `danger` (default Lucide icon per tone; `icon={null}` to drop it).
- **`<StatusPill tone label>`** and **`<OrderStatusPill status>`** — status pills driven
  by a shared registry (`status-pill.tsx`). **Do not** re-declare status → label/color
  maps in a screen; add to `ORDER_STATUS_DESCRIPTORS` (or a sibling registry) instead.
  The registry is keyed by the `@fd/shared` `OrderStatus` union, so a new status is a
  compile error until it's given a `{ label, tone }`.

### Navigation & disclosure (on `@base-ui/react`)

- **`<Tabs>` / `<TabsList>` / `<TabsTab>` / `<TabsPanel>`** — underline tabbed content with
  real `tablist` / `tab` / `tabpanel` ARIA + keyboard nav. Controlled (`value` +
  `onValueChange`) or uncontrolled (`defaultValue`).
- **`<SegmentedControl options value onValueChange glass>`** — compact pill-group value
  selector (no panels) — the shape most of the app's inline "filter tabs" actually are.
  `glass` frosts the container for sticky headers. **Do not** hand-roll a button list with
  conditional `bg-kd-primary` active styling and no ARIA.
- **`<Accordion multiple>` / `<AccordionItem value>` / `<AccordionTrigger>` /
  `<AccordionPanel>`** — accessible collapsible group; replaces native `<details>`.
- **`<LoadMore hasMore loading onLoadMore>`** — cursor/offset "Load more" button (renders
  nothing when `!hasMore`). **`<Pagination page pageCount onPageChange>`** — numbered pager.

### Form controls (on `@base-ui/react`)

- **`<Switch checked onCheckedChange>`** — on/off toggle. Use for boolean settings /
  filters instead of a styled native checkbox.
- **`<Checkbox checked onCheckedChange>`** (supports `indeterminate`) — multi-select /
  opt-in.
- **`<Select>` / `<SelectTrigger>` / `<SelectValue>` / `<SelectContent>` / `<SelectItem>`**
  — the design-system dropdown (the app had no dropdown layer). `<SelectValue>` accepts a
  `(value) => label` render function. Prefer over a bare native `<select>` when the trigger
  must match the design.
- **`<NumberStepper value onValueChange min max>`** — accessible −/＋ quantity counter.
- **`<RatingStars value count onChange size>`** — star rating; omit `onChange` for a
  read-only display, pass it to make it an input.

## Dark mode

Do not write `dark:` neutral/color overrides by hand. Because every `--kd-*`
token already defines a `.dark` value, using the kd utilities gives correct
light and dark rendering automatically. Only add `dark:` overrides for genuinely
bespoke chrome that falls outside the token system.

---

## Liquid Glass

The house style is Apple-style **liquid glass**: frosted translucent layers with a
blurred backdrop, a 1px light border, and an inset specular top edge. Glass is a
**material _option_, not a blanket** — it only reads over something colorful, and
legibility must win on critical surfaces. Default to a solid `bg-kd-surface`; reach
for glass on the hero, sticky headers, chips over imagery, state panels, and
overlays. Keep **solid** fills for paid/merchandising badges and status pills.

**Glass needs a backdrop.** Pair on-page glass with `<AmbientBackground />` (soft
blurred brand-color blobs) or place chips over imagery — glass on a flat surface
looks muddy.

### Tokens (theme-aware; flip to warm charcoal in `.dark`)

| Token                     | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `--kd-glass-bg`           | Standard frosted panel fill                    |
| `--kd-glass-bg-strong`    | Denser fill — legibility-first / text panels   |
| `--kd-glass-border`       | 1px hairline edge                              |
| `--kd-glass-highlight`    | Inset specular top-edge highlight (box-shadow) |
| `--kd-glass-badge`        | Small pill floating over media                 |
| `--kd-glass-badge-border` | Border for the on-media badge                  |
| `--kd-shadow-sm/md/lg`    | Depth scale → `shadow-kd-sm` / `-md` / `-lg`   |

### Utilities & primitives

- **`kd-glass`** (utility) — on-media chip. **Constant white translucency in both
  themes** (a photo looks the same regardless of app theme; white text/icons expected).
- **`kd-glass-badge`** (utility) — theme-aware pill floating over imagery.
- **`kd-glass-sheet`** / **`kd-glass-solid`** (utilities) — on-page panels
  (standard / legibility-first). Token-driven, so they flip in dark mode.
- **`<GlassPanel variant="default|strong">`** — the panel primitive (rounded +
  `shadow-kd-md`); prefer it over the raw utility for state blocks / cards.
- **`<GlassBadge>`** — on-media pill primitive (white text).
- **`<Card variant="glass">`** — frosted variant of the standard card.
- **`<AmbientBackground />`** — decorative blurred color blobs; fills its nearest
  `relative` ancestor at `-z-10`.

**Rule of thumb:** on media → `kd-glass` / `GlassBadge` (white). On the page →
`GlassPanel` / `Card variant="glass"` (theme-aware). Never hand-roll
`backdrop-filter` + `rgba()` in a component — use a utility or primitive so the
blur values and the specular edge stay consistent.
