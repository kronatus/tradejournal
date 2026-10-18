"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { ResetPasswordInputSchema } from "@/lib/schemas";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { user, loading: authLoading, isRecovery, updatePassword } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = ResetPasswordInputSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      await updatePassword(parsed.data.password);
      router.push("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return <div className="py-12 text-center">Loading...</div>;
  }

  // Only reachable through a valid recovery link; a plain signed-in visit to
  // this URL shouldn't offer a password change without the emailed proof.
  if (!user || !isRecovery) {
    return (
      <div className="mx-auto mt-12 max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Link invalid or expired</h1>
        <p className="mt-1 text-sm text-text-muted">
          Request a new password reset link to continue.
        </p>
        <Link
          href="/forgot-password"
          className="mt-6 inline-block rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Request new link
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        {error && (
          <div className="mb-4 rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-sm text-loss">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-subtle focus:border-accent"
              required
              minLength={6}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-subtle focus:border-accent"
              required
              minLength={6}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {loading ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
