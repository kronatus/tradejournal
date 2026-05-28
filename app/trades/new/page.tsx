import Link from "next/link";
import StrategyForm from "@/components/strategy-form";
import { ProtectedRoute } from "@/components/protected-route";

export default function NewTradePage() {
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

        <StrategyForm />
      </div>
    </ProtectedRoute>
  );
}
