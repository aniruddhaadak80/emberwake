import { Suspense } from "react";
import { RoundPlay } from "@/components/round/RoundPlay";
import { PageHeader } from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function RoundDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PageHeader
        title="Round"
        blurb="Choose a player, then light a facet of the beacon. Every click is a real, persisted contribution."
      />
      {/* Suspense is required because RoundPlay reads URL state for the active player. */}
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 text-fog-200" role="status">
            Loading the round…
          </div>
        }
      >
        <RoundPlay roundId={id} />
      </Suspense>
    </>
  );
}