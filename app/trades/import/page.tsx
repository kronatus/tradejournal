"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const BROKERS = [
  "TastyTrade",
  "ThinkorSwim",
  "Interactive Brokers",
  "Robinhood",
  "Schwab",
  "Fidelity",
  "Generic",
];

export default function ImportPage() {
  const { session } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [broker, setBroker] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    summary: {
      fillCount: number;
      strategyCount: number;
      legCount: number;
      skippedCount: number;
      unmatchedCloses: number;
    };
    skipped: Array<{ reason: string; raw: string }>;
  } | null>(null);
  const [error, setError] = useState<string>("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.access_token) {
      setError("Please sign in to import trades");
      return;
    }

    if (!broker) {
      setError("Please select a broker");
      return;
    }

    if (!file) {
      setError("Please select a CSV file");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("csv", file);
      formData.append("broker", broker.toLowerCase().replace(/\s+/g, ""));

      const response = await fetch("/api/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Import failed");
        return;
      }

      setResult(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An error occurred during import"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/trades"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text"
        >
          ← Back to trades
        </Link>
      </div>

      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Import trades</h1>
        <p className="mt-1 text-sm text-text-muted">
          Upload a broker CSV. We&apos;ll detect the format and group fills into strategies.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">1. Choose your broker</h2>
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 py-5 sm:grid-cols-3 md:grid-cols-4">
            {BROKERS.map((b) => (
              <label
                key={b}
                className="flex cursor-pointer items-center justify-center rounded-md border border-border bg-surface px-3 py-3 text-sm text-text-muted transition-all hover:border-accent hover:bg-accent-soft hover:text-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:checked]:font-medium"
              >
                <input
                  type="radio"
                  name="broker"
                  value={b}
                  checked={broker === b}
                  onChange={(e) => setBroker(e.target.value)}
                  className="sr-only"
                />
                {b}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">2. Upload CSV</h2>
          </div>
          <div className="px-5 py-5">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center transition-colors hover:border-accent hover:bg-accent-soft">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-text-muted">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-5 w-5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 4v12m0-12-4 4m4-4 4 4M4 20h16"
                  />
                </svg>
              </div>
              <div className="text-sm font-medium text-text">
                {file ? (
                  <span>{file.name}</span>
                ) : (
                  <>
                    Drop CSV here or <span className="text-accent">browse files</span>
                  </>
                )}
              </div>
              <div className="mt-1 text-xs text-text-muted">CSV up to 10MB</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        </section>

        {error && (
          <div className="rounded-md border border-error bg-error-soft px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !broker || !file || !session?.access_token}
          className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Importing..." : "Import trades"}
        </button>
      </form>

      {result && (
        <section className="rounded-lg border border-border bg-surface shadow-sm">
          <div className="border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">Import complete</h2>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-text-muted">Fills parsed</div>
                <div className="text-2xl font-semibold">{result.summary.fillCount}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Strategies</div>
                <div className="text-2xl font-semibold">{result.summary.strategyCount}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Legs</div>
                <div className="text-2xl font-semibold">{result.summary.legCount}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Skipped</div>
                <div className="text-2xl font-semibold">{result.summary.skippedCount}</div>
              </div>
            </div>

            {result.skipped.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-text-muted">Skipped rows:</h3>
                <div className="max-h-48 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 text-xs">
                  {result.skipped.map((skip, i) => (
                    <div key={i} className="py-1 border-b border-border last:border-0">
                      <div className="font-medium text-text-muted">{skip.reason}</div>
                      {skip.raw && <div className="text-text-muted truncate">{skip.raw}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/trades"
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-text transition-colors hover:bg-accent/90"
            >
              View imported strategies
            </Link>
          </div>
        </section>
      )}

      <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-xs text-text-muted">
        <span className="font-semibold text-text">Tip:</span> We never store your full
        broker export — only the parsed fills you import.
      </div>
    </div>
  );
}
