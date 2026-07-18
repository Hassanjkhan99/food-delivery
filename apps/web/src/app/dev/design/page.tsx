// Living design-system reference (#48 UX-13). Renders the McDonald's-style palette,
// typography scale, and every shared UI primitive so the tokens/components can be eyeballed
// in one place and used as the before/after proof surface. No auth, no data — pure kit.
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { AmbientBackground, GlassPanel, GlassBadge } from "@/components/ui/glass";
import { Star } from "lucide-react";

export const metadata = { title: "Design System — KhaanaDo" };

const SWATCHES: { name: string; className: string; note?: string }[] = [
  { name: "primary (red / CTA)", className: "bg-kd-primary text-white" },
  { name: "primary-hover", className: "bg-kd-primary-hover text-white" },
  { name: "primary-soft", className: "bg-kd-primary-soft text-kd-primary" },
  { name: "accent (gold)", className: "bg-kd-accent text-kd-fg" },
  { name: "accent-soft", className: "bg-kd-accent-soft text-kd-warning" },
  { name: "success", className: "bg-kd-success text-white" },
  { name: "bg (cream)", className: "bg-kd-bg text-kd-fg border border-kd-border" },
  { name: "surface", className: "bg-kd-surface text-kd-fg border border-kd-border" },
  { name: "surface-muted", className: "bg-kd-surface-muted text-kd-fg" },
  { name: "fg (charcoal)", className: "bg-kd-fg text-white" },
  { name: "fg-muted", className: "bg-kd-fg-muted text-white" },
  { name: "border", className: "bg-kd-border text-kd-fg" },
  { name: "warning", className: "bg-kd-warning text-white" },
  { name: "danger", className: "bg-kd-danger text-white" },
  { name: "info", className: "bg-kd-info text-white" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-kd-heading font-bold text-kd-fg">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignKitPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-12 px-4 py-10">
      <header className="space-y-2">
        <Badge variant="accent">Design System</Badge>
        <h1 className="text-kd-display font-extrabold tracking-tight text-kd-fg">
          KhaanaDo — Fast-food identity
        </h1>
        <p className="max-w-2xl text-kd-body text-kd-fg-muted">
          Cream-dominant surfaces, warm charcoal text, red for primary actions, golden yellow as the
          accent. All colors come from <code className="text-kd-primary">--kd-*</code> tokens;
          primitives inherit them via the shadcn bridge. See{" "}
          <code className="text-kd-primary">components/ui/THEME.md</code>.
        </p>
      </header>

      <Section title="Palette">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map((s) => (
            <div
              key={s.name}
              className={`flex h-20 flex-col justify-end rounded-xl p-2 text-xs font-semibold ${s.className}`}
            >
              {s.name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography scale">
        <div className="space-y-2">
          <p className="text-kd-display font-extrabold text-kd-fg">Display · 36/40</p>
          <p className="text-kd-heading font-bold text-kd-fg">Heading · 24/32</p>
          <p className="text-kd-title font-semibold text-kd-fg">Title · 18/28</p>
          <p className="text-kd-body text-kd-fg">Body · 16/24 — the quick brown fox jumps.</p>
          <p className="text-kd-label text-kd-fg-muted">Label · 14/20</p>
          <p className="text-kd-caption text-kd-fg-subtle">Caption · 12/16</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="brand">Add to cart</Button>
          <Button variant="default">Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="brand" size="lg">
            Large
          </Button>
          <Button variant="brand">Default size</Button>
          <Button variant="brand" size="sm">
            Small
          </Button>
          <Button variant="brand" size="xs">
            XS
          </Button>
          <Button variant="brand" disabled>
            Disabled
          </Button>
        </div>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="brand">Promoted</Badge>
          <Badge variant="accent">Deal</Badge>
          <Badge variant="accent-soft">-20%</Badge>
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Closed</Badge>
        </div>
      </Section>

      <Section title="Cards & chips">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="p-4">
            <h3 className="text-kd-title font-semibold text-kd-fg">Card surface</h3>
            <p className="mt-1 text-kd-label text-kd-fg-muted">
              On <code>bg-kd-surface</code> with a warm border. Prices in{" "}
              <span className="font-semibold text-kd-primary">red</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="rounded-full border border-kd-border bg-kd-surface px-3 py-1 text-sm text-kd-fg-muted">
                Chip
              </span>
              <span className="rounded-full bg-kd-primary-soft px-3 py-1 text-sm font-semibold text-kd-primary">
                Active chip
              </span>
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            <Input placeholder="Input field…" />
            <Textarea placeholder="Textarea…" />
          </Card>
        </div>
      </Section>

      <Section title="Skeletons">
        <div className="flex items-center gap-3">
          <Skeleton className="h-16 w-16 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      </Section>

      <Section title="Liquid Glass">
        <p className="max-w-2xl text-kd-label text-kd-fg-muted">
          Frosted material — pairs with an ambient backdrop or sits over imagery. On-page panels are
          theme-aware; on-media chips stay white. See{" "}
          <code className="text-kd-primary">components/ui/THEME.md</code> → Liquid Glass.
        </p>

        {/* On-page panels over an ambient backdrop (what glass looks like in the app). */}
        <div className="relative overflow-hidden rounded-3xl border border-kd-border p-6">
          <AmbientBackground />
          <div className="relative grid gap-4 sm:grid-cols-2">
            <GlassPanel className="p-4">
              <h3 className="text-kd-title font-semibold text-kd-fg">GlassPanel · default</h3>
              <p className="mt-1 text-kd-label text-kd-fg-muted">
                Standard frosted sheet on the page background.
              </p>
            </GlassPanel>
            <GlassPanel variant="strong" className="p-4">
              <h3 className="text-kd-title font-semibold text-kd-fg">GlassPanel · strong</h3>
              <p className="mt-1 text-kd-label text-kd-fg-muted">
                Denser fill for text-heavy / state panels.
              </p>
            </GlassPanel>
          </div>
        </div>

        {/* On-media chips over a brand gradient (badges float over a scrim). */}
        <div className="relative flex h-40 items-end gap-2 overflow-hidden rounded-3xl bg-gradient-to-br from-kd-primary to-kd-accent p-4">
          <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/30 to-transparent" />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1 rounded-full bg-kd-primary px-2.5 py-1 text-xs font-bold text-white shadow-sm">
            Promoted (solid)
          </span>
          <GlassBadge>
            <Star className="h-3 w-3 fill-kd-accent text-kd-accent" />
            4.7
          </GlassBadge>
          <span className="kd-glass inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-white">
            kd-glass chip
          </span>
        </div>
      </Section>
    </main>
  );
}
