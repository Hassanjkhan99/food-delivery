"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/rider", label: "Jobs" },
  { href: "/rider/earnings", label: "Earnings" },
];

export default function RiderLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-neutral-50">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="font-bold">🛵 Rider</span>
          <nav className="flex gap-3 text-sm">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={
                  pathname === t.href ? "font-semibold text-neutral-900" : "text-neutral-500"
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="flex-1 p-4">{children}</div>
    </div>
  );
}
