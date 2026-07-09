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
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-neutral-900">
            🍜 Khaana<span className="text-rose-600">Do</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/orders" className="text-neutral-600 hover:text-neutral-900">
              Orders
            </Link>
            <Link
              href="/cart"
              className="relative flex items-center gap-1 text-neutral-600 hover:text-neutral-900"
            >
              <ShoppingBag className="h-5 w-5" />
              {lines.length > 0 && (
                <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
                  {lines.length}
                </span>
              )}
            </Link>
            {viewer ? (
              <Link
                href="/account"
                className="flex items-center gap-1 text-neutral-600 hover:text-neutral-900"
              >
                <User className="h-5 w-5" />
                <span className="hidden sm:inline">{viewer.user?.name ?? "Account"}</span>
              </Link>
            ) : (
              <Link
                href="/login"
                className="rounded-lg bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-700"
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
