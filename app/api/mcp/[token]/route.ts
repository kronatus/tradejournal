/**
 * App-hosted MCP endpoint for Claude chat (custom connector).
 *
 * The connector URL carries a per-user secret: /api/mcp/<secret>. claude.ai
 * custom connectors cannot send custom headers without OAuth, so the secret
 * lives in the path; only its sha256 is stored (mcp_tokens), and the user can
 * revoke it from the Research tab. Unknown secrets get a 404.
 */
import { handleMcpRequest } from "@/lib/mcp/server";
import { adminClient } from "@/lib/server/admin";
import { refreshMarketData } from "@/lib/server/market";
import { createMarketStore, createResearchStore, resolveMcpToken } from "@/lib/research-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handle(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const db = adminClient();
    return await handleMcpRequest(request, {
      secret: token,
      resolveUser: (secret) => resolveMcpToken(db, secret),
      makeDeps: (userId) => ({
        research: createResearchStore(db, userId),
        market: createMarketStore(db),
        refreshMarket: () => refreshMarketData(db),
        now: () => new Date(),
      }),
    });
  } catch (error) {
    console.error("[mcp] request failed:", error);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}

export { handle as GET, handle as POST, handle as DELETE };
