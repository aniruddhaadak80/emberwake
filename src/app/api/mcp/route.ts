/**
 * POST /api/mcp — the agent endpoint.
 *
 * Speaks JSON-RPC 2.0 over HTTP and supports `initialize`, `tools/list`,
 * `tools/call` and `ping`. Every call is scoped to the caller's anonymous
 * session cookie, so an agent can only ever reach the rounds that session owns.
 *
 * `GET` returns a small discovery document so a human or a client can confirm
 * the endpoint is live and see which tools exist without constructing a request.
 */

import { NextResponse } from "next/server";
import { badRequest, handleServerError, PayloadTooLargeError, readJson } from "@/lib/api";
import { MCP_TOOLS, PROTOCOL_VERSION, SERVER_INFO, dispatchRpc } from "@/lib/mcp";
import { getOrCreateScope } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    endpoint: "/api/mcp",
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    transport: "JSON-RPC 2.0 over HTTP POST",
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      mutating: tool.mutating,
      inputSchema: tool.inputSchema,
    })),
    usage: {
      initialize: { method: "initialize", params: {} },
      listTools: { method: "tools/list", params: {} },
      callTool: {
        method: "tools/call",
        params: { name: "get_round_analysis", arguments: { roundId: "<uuid>" } },
      },
    },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await readJson(request, 64_000);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return badRequest("That request body was too large.");
      // JSON parse failure is a JSON-RPC parse error, not an HTTP 400.
      return NextResponse.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Request body was not valid JSON." } },
        { status: 200 },
      );
    }

    // The endpoint mints a scope on first contact so an agent client can create
    // and mutate its own rounds without a signup step.
    const scope = await getOrCreateScope();
    const response = await dispatchRpc(body, scope);

    // Notifications legitimately have no body.
    if (response === null) return new NextResponse(null, { status: 204 });

    const isError = "error" in response;
    return NextResponse.json(response, { status: isError ? 400 : 200 });
  } catch (error) {
    return handleServerError(error);
  }
}