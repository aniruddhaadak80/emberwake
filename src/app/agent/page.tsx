import { PageHeader } from "@/components/PageHeader";
import { AgentConsole } from "@/components/agent/AgentConsole";

export const dynamic = "force-dynamic";

export default function AgentPage() {
  return (
    <>
      <PageHeader
        title="Agent console"
        blurb="A live JSON-RPC 2.0 endpoint speaking the Model Context Protocol. Discover the tools, then use them to actually change a round."
      />
      <AgentConsole />
    </>
  );
}