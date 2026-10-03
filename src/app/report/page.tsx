import { Suspense } from "react";
import { PageHeader } from "@/components/PageHeader";
import { ReportView } from "@/components/report/ReportView";

export const dynamic = "force-dynamic";

export default function ReportPage() {
  return (
    <>
      <PageHeader
        title="Round report"
        blurb="Who played, who was left out, how the light was shared, and when the daylight was actually good enough to be outside."
      />
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 text-fog-200" role="status">
            Loading the report…
          </div>
        }
      >
        <ReportView />
      </Suspense>
    </>
  );
}