"use client";

import Link from "next/link";
import { useQuery } from "urql";
import { ShoppingBag, User } from "lucide-react";
import { graphql } from "@/graphql/generated";
import { useCart } from "@/lib/cart";

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

  return (
    <div className="flex min-h-screen flex-col bg-kd-bg">
      <header className="sticky top-0 z-40 border-b border-kd-border bg-kd-surface/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-kd-fg">
            🍜 Khaana<span className="text-kd-primary">Do</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/orders" className="text-kd-fg-muted hover:text-kd-fg">
              Orders
            </Link>
            <Link href="/help" className="hidden text-kd-fg-muted hover:text-kd-fg sm:inline">
              Help
            </Link>
            <Link
              href="/cart"
              className="relative flex items-center gap-1 text-kd-fg-muted hover:text-kd-fg"
            >
              <ShoppingBag className="h-5 w-5" />
              {lines.length > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-kd-primary text-[10px] font-bold text-white">
                  {lines.length}
                </span>
              )}
            </Link>
            {viewer ? (
              <Link
                href="/account"
                className="flex items-center gap-1 text-kd-fg-muted hover:text-kd-fg"
              >
                <User className="h-5 w-5" />
                <span className="hidden sm:inline">{viewer.user?.name ?? "Account"}</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-kd-primary px-3 py-1.5 font-medium text-white hover:bg-kd-primary-hover"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
