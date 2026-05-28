"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/trades", label: "Trades" },
  { href: "/trades/new", label: "New" },
  { href: "/trades/import", label: "Import" },
  { href: "/sandbox", label: "Sandbox" },
];

export default function Header() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/80 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white text-sm font-bold">
            TJ
          </span>
          <span className="text-sm font-semibold tracking-tight">Trade Journal</span>
        </Link>

        {!loading && user ? (
          <div className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "rounded-md px-3 py-1.5 text-sm transition-colors " +
                    (active
                      ? "bg-muted text-text font-medium"
                      : "text-text-muted hover:bg-muted hover:text-text")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ) : null}

        <div className="flex items-center gap-3 text-sm">
          {!loading && (
            user ? (
              <>
                <span className="hidden text-text-muted sm:inline">{user.email}</span>
                <button
                  onClick={handleSignOut}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-text-muted transition-colors hover:border-border-strong hover:text-text"
                >
                  Sign out
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md bg-accent px-3 py-1.5 text-white transition-colors hover:bg-accent-hover"
              >
                Sign in
              </Link>
            )
          )}
        </div>
      </nav>
    </header>
  );
}
