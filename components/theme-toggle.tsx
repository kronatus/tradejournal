"use client";

import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "theme";

/**
 * Applies a choice to the document. "system" removes the attribute so the
 * `color-scheme: light dark` on :root defers to the OS again.
 */
function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

// The stored choice is external state, so it is read through a store rather
// than copied into React state in an effect. The snapshot is cached because
// useSyncExternalStore requires a stable value between changes.
const listeners = new Set<() => void>();
let snapshot: ThemeChoice | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  // Another tab changing the preference should update this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== STORAGE_KEY) return;
    snapshot = readStored();
    apply(snapshot);
    emit();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ThemeChoice {
  if (snapshot === null) snapshot = readStored();
  return snapshot;
}

/** The server cannot know the choice; the inline head script paints it. */
function getServerSnapshot(): ThemeChoice {
  return "system";
}

function persist(next: ThemeChoice) {
  snapshot = next;
  apply(next);
  try {
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private browsing or blocked storage: the choice still applies to this
    // page, it just will not be remembered.
  }
  emit();
}

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] = [
  {
    value: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    ),
  },
  {
    value: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {OPTIONS.map((opt) => {
        const active = choice === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => persist(opt.value)}
            aria-pressed={active}
            title={opt.label}
            className={
              "inline-flex h-6 w-6 items-center justify-center rounded transition-colors " +
              (active
                ? "bg-muted text-text"
                : "text-text-subtle hover:text-text")
            }
          >
            {opt.icon}
            <span className="sr-only">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
