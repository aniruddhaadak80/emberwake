import { PageHeader } from "@/components/PageHeader";
import { JoinRound } from "@/components/round/JoinRound";

export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <>
      <PageHeader
        title="Join a round"
        blurb="Somebody handed you a code. Add your name and you are in — no account, no install, no app store."
      />
      <JoinRound code={code} />
    </>
  );
}