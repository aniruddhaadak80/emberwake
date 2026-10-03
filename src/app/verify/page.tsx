import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { VerifyView } from "@/components/verify/VerifyView";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <>
      <PageHeader
        title="Verify the record"
        blurb="Replay a round's SHA-384 hash chain from its genesis value and find the first broken link, if there is one."
      />
      <Suspense
        fallback={
          <div className="mx-auto max-w-5xl px-4 py-16 text-fog-200" role="status">
            Loading…
          </div>
        }
      >
        <VerifyView />
      </Suspense>
    </>
  );
}