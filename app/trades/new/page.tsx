import Link from "next/link";
import StrategyForm from "@/components/strategy-form";
import { ProtectedRoute } from "@/components/protected-route";
import { IdeaTradeForm } from "@/components/idea-trade-form";

export default async function NewTradePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const setId = typeof params.set === "string" ? params.set : null;
  const rank = typeof params.idea === "string" ? Number(params.idea) : NaN;
  return (
    <ProtectedRoute>
      <div className="space-y-6">
        <div>
          <Link
            href="/trades"
            className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
          >
            ← Back to trades
          </Link>
        </div>

        <header>
          <h1 className="text-3xl font-semibold tracking-tight">New trade</h1>
          <p className="mt-1 text-sm text-text-muted">
            Log a new options strategy. Add one or more legs below.
          </p>
        </header>

        {setId && Number.isInteger(rank) ? <IdeaTradeForm setId={setId} rank={rank} /> : <StrategyForm />}
      </div>
    </ProtectedRoute>
  );
}
