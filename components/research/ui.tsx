"use client";

import { useState } from "react";
import type { Tone } from "@/lib/research";
import { Term } from "@/components/ui/term";

const TONE_CLASSES: Record<Tone, string> = {
  gain: "bg-gain-soft text-gain",
  loss: "bg-loss-soft text-loss",
  warn: "bg-warn-soft text-warn",
  neutral: "bg-muted text-text-muted",
};

export function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " + TONE_CLASSES[tone]
      }
    >
      {children}
    </span>
  );
}

/** Text colour for a signed number. */
export function signClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "text-text-muted";
  return v > 0 ? "text-gain" : "text-loss";
}

export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"rounded-lg border border-border bg-surface p-5 shadow-sm " + className}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Copies `text` and confirms briefly. Used to hand prompts over to Claude chat. */
export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked (insecure origin, permissions); the text
          // is visible next to the button, so the user can still copy it.
        }
      }}
      className={
        "rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text " +
        className
      }
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** A prompt the user can paste into Claude chat, with a copy button. */
export function PromptHandoff({ prompt, hint }: { prompt: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm">
      {hint && <span className="text-text-muted">{hint}</span>}
      <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{prompt}</code>
      <CopyButton text={prompt} />
    </div>
  );
}

export function Stat({
  label,
  term,
  value,
  sub,
  valueClass = "",
}: {
  label: string;
  /** Glossary key: renders the label as a <Term> with an explanation bubble. */
  term?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  valueClass?: string;
}) {
  return (
    // data-term-row: the bubble is placed outside this whole block, so it
    // never covers the value under the label.
    <div className="min-w-0" data-term-row>
      <div className="text-xs text-text-muted">{term ? <Term k={term}>{label}</Term> : label}</div>
      <div className={"tabular mt-0.5 truncate text-sm font-medium " + valueClass}>{value}</div>
      {sub && <div className="tabular truncate text-xs text-text-subtle">{sub}</div>}
    </div>
  );
}
