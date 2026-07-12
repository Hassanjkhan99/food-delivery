"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { Search, ShoppingBag, User } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { useCart } from "@/lib/cart";
import { useI18n } from "@/i18n/provider";
import { LocaleSwitcher } from "@/i18n/LocaleSwitcher";
import { NotificationBell } from "@/components/NotificationBell";
import { Wordmark } from "@/components/brand/Wordmark";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ViewerQuery = graphql(`
  query CustomerViewer {
    viewer {
      home
      user {
        id
        name
        phone
      }
    }
  }
`);

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  const lines = useCart((s) => s.lines);
  const [{ data }] = useQuery({ query: ViewerQuery });
  const viewer = data?.viewer;
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen flex-col bg-kd-bg">
      <header className="sticky top-0 z-40 border-b border-kd-border bg-kd-surface/90 backdrop-blur">
        <div className="mx-auto flex h-[72px] max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-12">
          <Link href="/" className="text-kd-fg" aria-label="KhaanaDo home">
            <Wordmark />
          </Link>
          <nav className="flex items-center gap-4 text-[17px] font-medium sm:gap-6 lg:gap-8">
            <LocaleSwitcher />
            <Link
              href="/search"
              aria-label={t("nav.search")}
              className="rounded text-kd-fg-muted hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2"
            >
              <Search className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
            </Link>
            <Link
              href="/orders"
              className="rounded text-kd-fg-muted hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2"
            >
              {t("nav.orders")}
            </Link>
            <Link href="/help" className="hidden text-kd-fg-muted hover:text-kd-fg sm:inline">
              Help
            </Link>
            <Link
              href="/cart"
              aria-label={
                lines.length > 0
                  ? `${t("a11y.viewCartItems")}, ${lines.length}`
                  : t("a11y.viewCartItems")
              }
              className="relative flex items-center gap-1 rounded text-kd-fg-muted hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2"
            >
              <ShoppingBag className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
              {lines.length > 0 && (
                <span className="absolute -end-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-kd-primary text-[10px] font-bold text-white">
                  {lines.length}
                </span>
              )}
            </Link>
            {viewer ? (
              <>
                <NotificationBell />
                <Link
                  href="/account"
                  aria-label={t("a11y.account")}
                  className="flex items-center gap-1 rounded text-kd-fg-muted hover:text-kd-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kd-primary focus-visible:ring-offset-2"
                >
                  <User className="h-[22px] w-[22px]" strokeWidth={1.75} aria-hidden />
                  <span className="hidden sm:inline">{viewer.user?.name ?? t("nav.account")}</span>
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                className={cn(buttonVariants({ variant: "brand", size: "sm" }), "font-semibold")}
              >
                {t("nav.signIn")}
              </Link>
            )}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-12">
        {children}
      </div>
    </div>
  );
}
