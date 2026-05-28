export function StatusBadge({ closed }: { closed: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
        (closed ? "bg-muted text-text-muted" : "bg-warn-soft text-warn")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " +
          (closed ? "bg-text-subtle" : "bg-warn")
        }
      />
      {closed ? "Closed" : "Open"}
    </span>
  );
}
