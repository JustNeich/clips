import { TemplateStyleEditor } from "../../components/TemplateStyleEditor";
import { getCurrentAuthContext } from "../../../lib/auth/session";
import { canInspectSensitiveArtifacts } from "../../../lib/sensitive-access";
import { notFound } from "next/navigation";

type TemplateRoadPageProps = {
  searchParams?: Promise<{ template?: string }>;
};

export default async function TemplateRoadPage({
  searchParams
}: TemplateRoadPageProps) {
  const auth = await getCurrentAuthContext();
  if (!auth || !canInspectSensitiveArtifacts(auth.membership.role)) {
    notFound();
  }
  const params = (await searchParams) ?? {};

  return (
    <TemplateStyleEditor initialTemplateId={params.template ?? null} />
  );
}
