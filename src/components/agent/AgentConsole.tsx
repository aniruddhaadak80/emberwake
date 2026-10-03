"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Play, TriangleAlert } from "lucide-react";
import { callRpc, listRounds, type RpcResponse } from "@/lib/client";
import type { Member, Round } from "@/lib/types";
import { cn } from "@/lib/utils";

type McpTool = NonNullable<NonNullable<RpcResponse["result"]>["tools"]>[number];

type LogEntry = {
  id: number;
  label: string;
  request: unknown;
  response: RpcResponse | { error: string };
  roundId?: string;
  emberId?: string;
  isError: boolean;
};

/**
 * Live MCP console.
 *
 * This is the agent surface, not a mock-up of one. Every button here issues a
 * real JSON-RPC request to `/api/mcp`, and the request and response are both
 * shown verbatim, including failures. If a tool refuses because of validation or
 * permissions, that refusal is displayed rather than hidden behind a toast.
 */
export function AgentConsole() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [serverInfo, setServerInfo] = useState<{ name: string; version: string } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const page = await listRounds({ limit: 10 });
        setRounds(page.rounds);
        if (page.rounds.length > 0) setRoundId(page.rounds[0].id);
      } catch {
        setRounds([]);
      }
    })();
  }, []);

  // Pull the roster so light_facet can be preloaded with a real member id.
  useEffect(() => {
    if (!roundId) return;
    void (async () => {
      try {
        const response = await fetch(`/api/rounds/${roundId}`);
        if (!response.ok) return;
        const data = (await response.json()) as { bundle?: { members: Member[] } };
        setMembers(data.bundle?.members ?? []);
      } catch {
        setMembers([]);
      }
    })();
  }, [roundId]);

  const send = useCallback(
    async (label: string, method: string, params: Record<string, unknown>) => {
      setBusy(label);
      const request = { jsonrpc: "2.0", id: Date.now(), method, params };
      let response: RpcResponse | { error: string };
      try {
        response = await callRpc(method, params);
      } catch (cause) {
        response = { error: cause instanceof Error ? cause.message : "Request failed." };
      }

      const structured = (response as RpcResponse).result?.structuredContent as
        | Record<string, unknown>
        | undefined;
      const roundIdFromResult =
        (structured?.roundId as string | undefined) ?? (structured?.emberId ? roundId ?? undefined : undefined);

      setLog((entries) =>
        [
          {
            id: Date.now() + Math.random(),
            label,
            request,
            response,
            roundId: roundIdFromResult ?? (method === "list_rounds" ? roundId ?? undefined : undefined),
            isError:
              "error" in response || (response as RpcResponse).result?.isError === true,
          },
          ...entries,
        ].slice(0, 30),
      );

      if (method === "tools/list") {
        setTools((response as RpcResponse).result?.tools ?? []);
      }
      if (method === "initialize") {
        setServerInfo((response as RpcResponse).result?.serverInfo ?? null);
      }
      setBusy(null);
    },
    [roundId],
  );

  /** Runs initialize then tools/list, the standard MCP handshake. */
  async function handshake() {
    await send("initialize", "initialize", {});
    await send("tools/list", "tools/list", {});
  }

  const firstMember = members[0];

  const presets = useMemo(
    () => [
      {
        label: "initialize",
        run: () => send("initialize", "initialize", {}),
        enabled: true,
      },
      {
        label: "tools/list",
        run: () => send("tools/list", "tools/list", {}),
        enabled: true,
      },
      { label: "list_rounds", run: () => send("list_rounds", "list_rounds", { limit: 5 }), enabled: true },
      {
        label: "get_round_analysis",
        run: () =>
          roundId
            ? send("get_round_analysis", "tools/call", {
                name: "get_round_analysis",
                arguments: { roundId },
              })
            : Promise.resolve(),
        enabled: Boolean(roundId),
      },
      {
        label: "light_facet (mutating)",
        run: () =>
          roundId && firstMember
            ? send("light_facet", "tools/call", {
                name: "light_facet",
                arguments: {
                  roundId,
                  memberId: firstMember.id,
                  facet: Math.floor(Math.random() * 12),
                  weight: 3,
                  // Replaying the same key must not add a second ember.
                  idempotencyKey: `console-${firstMember.id}-fixed`,
                },
              })
            : Promise.resolve(),
        enabled: Boolean(roundId && firstMember),
      },
      {
        label: "verify_integrity",
        run: () =>
          roundId
            ? send("verify_integrity", "tools/call", {
                name: "verify_integrity",
                arguments: { roundId },
              })
            : Promise.resolve(),
        enabled: Boolean(roundId),
      },
    ],
    [send, roundId, firstMember],
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="slab-flat p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-ember" onClick={handshake} disabled={busy !== null}>
            {busy === "initialize" ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
            Run initialize + tools/list
          </button>

          <label htmlFor="agent-round" className="datalabel">
            Round
          </label>
          <select
            id="agent-round"
            className="field max-w-xs"
            value={roundId ?? ""}
            onChange={(event) => setRoundId(event.target.value || null)}
            disabled={rounds.length === 0}
          >
            {rounds.length === 0 ? <option value="">No rounds in this session</option> : null}
            {rounds.map((round) => (
              <option key={round.id} value={round.id}>
                {round.title} · {round.joinCode}
              </option>
            ))}
          </select>

          {serverInfo ? (
            <span className="rounded-full border border-reached/40 bg-reached/10 px-2.5 py-1 font-mono text-xs text-reached">
              {serverInfo.name} {serverInfo.version}
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-xs text-fog-400">
          Calls are scoped to this browser session. Tools that mutate use the same repository code
          path as the UI, and accept an <span className="font-mono">idempotencyKey</span> so a retry
          cannot double-write.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="grid content-start gap-4">
          <div className="slab-flat p-4">
            <p className="datalabel">One-click calls</p>
            <div className="mt-3 grid gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="btn btn-ghost justify-start"
                  onClick={preset.run}
                  disabled={!preset.enabled || busy !== null}
                >
                  {busy === preset.label ? (
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                  ) : null}
                  {preset.label}
                </button>
              ))}
            </div>
            {rounds.length === 0 ? (
              <p className="mt-3 text-xs text-brass-400">
                Create a round first — the agent can only reach rounds owned by this session.
              </p>
            ) : null}
          </div>

          <div className="slab-flat p-4">
            <p className="datalabel">Discovered tools ({tools.length})</p>
            {tools.length === 0 ? (
              <p className="mt-2 text-sm text-fog-400">
                Run the handshake to discover tools from the live endpoint.
              </p>
            ) : (
              <ul className="mt-3 grid gap-3">
                {tools.map((tool) => (
                  <li key={tool.name} className="rounded-lg border border-tide-800 p-3">
                    <p className="font-mono text-sm text-ember-300">{tool.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-fog-200">{tool.description}</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer font-mono text-[0.65rem] text-fog-400">
                        input schema
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[0.65rem] text-fog-400">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <p className="datalabel">Requests and responses</p>
          {log.length === 0 ? (
            <div className="slab-flat p-5">
              <p className="text-sm text-fog-200">
                Nothing called yet. Run the handshake, or light a facet with the agent and watch the
                same beacon the UI lights up.
              </p>
            </div>
          ) : null}

          {log.map((entry) => (
            <article
              key={entry.id}
              className={cn("slab-flat p-4", entry.isError && "border-leftout/50")}
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-fog-050">{entry.label}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider",
                    entry.isError ? "bg-leftout/20 text-leftout" : "bg-reached/15 text-reached",
                  )}
                >
                  {entry.isError ? "error" : "ok"}
                </span>
              </header>

              {entry.isError ? (
                <p className="mt-2 flex items-start gap-2 text-sm text-fog-200">
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-leftout" aria-hidden="true" />
                  {(entry.response as { error?: string }).error ??
                    ((entry.response as RpcResponse).error?.message ?? "The call reported an error.")}
                </p>
              ) : null}

              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[0.65rem] text-fog-400">
                  raw JSON-RPC
                </summary>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[0.65rem] leading-relaxed text-fog-400">
{`→ ${JSON.stringify(entry.request, null, 2)}

← ${JSON.stringify(entry.response, null, 2)}`}
                </pre>
              </details>

              {entry.roundId ? (
                <Link href={`/round/${entry.roundId}`} className="btn btn-ghost mt-3 text-xs">
                  Open the persisted result
                </Link>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}