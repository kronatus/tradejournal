"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (isSignUp) {
        await signUp(email, password);
        setSuccess("Account created. Check your email to confirm.");
      } else {
        await signIn(email, password);
        router.push("/");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (signup: boolean) => {
    setIsSignUp(signup);
    setError(null);
    setSuccess(null);
  };

  return (
    <div className="mx-auto mt-12 max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-lg font-bold text-white">
          TJ
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {isSignUp
            ? "Start tracking your trades in seconds."
            : "Sign in to your trade journal."}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
          <button
            type="button"
            onClick={() => switchMode(false)}
            className={
              "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
              (!isSignUp ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text")
            }
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode(true)}
            className={
              "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
              (isSignUp ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text")
            }
          >
            Sign up
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-loss/40 bg-loss-soft px-3 py-2 text-sm text-loss">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-gain/40 bg-gain-soft px-3 py-2 text-sm text-gain">
            {success}
          </div>
        )}

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

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-muted">
              Password
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

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {loading
              ? isSignUp
                ? "Creating account…"
                : "Signing in…"
              : isSignUp
              ? "Create account"
              : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
