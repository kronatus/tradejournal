"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { ForgotPasswordInputSchema } from "@/lib/schemas";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const { resetPassword } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = ForgotPasswordInputSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    try {
      await resetPassword(parsed.data.email);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="mt-1 text-sm text-text-muted">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        {error && (
          <div className="mb-4 rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-sm text-loss">
            {error}
          </div>
        )}

        {sent ? (
          // Same message whether or not the address has an account, so this
          // page can't be used to probe which emails are registered.
          <div className="rounded-md border border-gain/40 bg-gain-soft px-3 py-2 text-sm text-gain">
            If an account exists for {email}, a password reset link is on its way.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-text-subtle focus:border-accent"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <div className="mt-4 text-center">
          <Link href="/login" className="text-xs text-text-muted hover:text-text">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
