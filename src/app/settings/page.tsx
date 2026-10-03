import { PageHeader } from "@/components/PageHeader";
import { SettingsView } from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Settings and status"
        blurb="What is actually running, where the data comes from, and what this build does with your family's information."
      />
      <SettingsView />
    </>
  );
}