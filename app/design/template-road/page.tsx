import { Stage3TemplateLab } from "../../components/Stage3TemplateLab";

type TemplateRoadPageProps = {
  searchParams?: Promise<{ template?: string }>;
};

export default async function TemplateRoadPage({ searchParams }: TemplateRoadPageProps) {
  const params = (await searchParams) ?? {};

  return <Stage3TemplateLab initialTemplateId={params.template ?? null} />;
}
