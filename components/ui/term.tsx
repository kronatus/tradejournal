"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lookupTerm, type GlossaryEntry } from "@/lib/glossary";

const GAP = 6;
const MARGIN = 8;

type Pos = { top: number; left: number; placement: "above" | "below" };

/**
 * A technical term with an explanation bubble on hover, keyboard focus or tap.
 *
 * Placement keeps values visible: the bubble is positioned outside the term's
 * *row* — the closest ancestor marked `data-term-row` (a label + value pair),
 * or the term itself — above it when there is room, otherwise below. It never
 * sits on top of the row, so the number the term labels stays readable, and it
 * ignores the pointer so it never blocks a chart crosshair or a click.
 *
 * Unknown keys render the children unchanged.
 */
export function Term({
  k,
  children,
  className = "",
}: {
  /** Glossary key or a metric name such as "rsi14" or "sma50_cents". */
  k: string;
  children: React.ReactNode;
  className?: string;
}) {
  const entry = lookupTerm(k);
  if (!entry) return <>{children}</>;
  return (
    <TermBubble entry={entry} className={className}>
      {children}
    </TermBubble>
  );
}

function TermBubble({
  entry,
  children,
  className,
}: {
  entry: GlossaryEntry;
  children: React.ReactNode;
  className: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const row = (trigger.closest("[data-term-row]") as HTMLElement | null) ?? trigger;
    const anchor = row.getBoundingClientRect();
    const own = trigger.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const above = anchor.top - GAP - height;
    const placement = above >= MARGIN ? "above" : "below";
    const top = placement === "above" ? above : anchor.bottom + GAP;
    const left = Math.min(Math.max(own.left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
    setPos({ top, left, placement });
  }, []);

  // Measure after the bubble mounts, then follow scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, place]);

  const close = () => {
    setOpen(false);
    setPos(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && close()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setOpen(true)}
        onBlur={close}
        onClick={(e) => {
          // Tap toggles on touch; a mouse click inside a link/row must not navigate.
          e.preventDefault();
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
        className={
          // Inherit case/tracking so a term inside an uppercase heading stays uppercase.
          "cursor-help text-left underline decoration-text-subtle decoration-dotted underline-offset-[3px] [letter-spacing:inherit] [text-transform:inherit] " +
          "hover:decoration-text-muted focus-visible:rounded-sm " +
          className
        }
      >
        {children}
      </button>
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            data-placement={pos?.placement}
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
            }}
            className="pointer-events-none z-50 w-max max-w-[18rem] rounded-md border border-border bg-surface px-3 py-2 text-left text-xs font-normal normal-case tracking-normal text-text shadow-lg"
          >
            <div className="font-semibold">{entry.term}</div>
            <p className="mt-1 leading-snug">{entry.what}</p>
            <p className="mt-1 leading-snug text-text-muted">{entry.why}</p>
          </div>,
          document.body
        )}
    </>
  );
}
