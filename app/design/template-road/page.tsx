import { TemplateStyleEditor } from "../../components/TemplateStyleEditor";

type TemplateRoadPageProps = {
  searchParams?: Promise<{ template?: string }>;
};

export default async function TemplateRoadPage({
  searchParams
}: TemplateRoadPageProps) {
  const params = (await searchParams) ?? {};

  return (
    <TemplateStyleEditor initialTemplateId={params.template ?? null} />
  );
}
