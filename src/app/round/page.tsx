import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { RoundWorkspace } from "@/components/round/RoundWorkspace";

export const dynamic = "force-dynamic";

export default function RoundsPage() {
  return (
    <>
      <PageHeader
        title="Your rounds"
        blurb="Make a round, hand out its QR code, and see who actually got to play. Rounds live under this browser's anonymous session, so no account is ever needed."
      />
      {/* RoundWorkspace reads the status filter from URL state. */}
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 text-fog-200" role="status">
            Loading your rounds…
          </div>
        }
      >
        <RoundWorkspace />
      </Suspense>
    </>
  );
}