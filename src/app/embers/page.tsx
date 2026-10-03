import { PageHeader } from "@/components/PageHeader";
import { EmbersView } from "@/components/embers/EmbersView";

export const dynamic = "force-dynamic";

export default function EmbersPage() {
  return (
    <>
      <PageHeader
        title="Embers"
        blurb="Every facet that was lit and every voice memo that was transcribed, in the order it happened, with the provenance of each transcript."
      />
      <EmbersView />
    </>
  );
}