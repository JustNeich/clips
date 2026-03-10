import { Stage3TemplateLab } from "../../components/Stage3TemplateLab";

type TemplateLabPageProps = {
  searchParams?: Promise<{ template?: string }>;
};

export default async function TemplateLabPage({ searchParams }: TemplateLabPageProps) {
  const params = (await searchParams) ?? {};

  return <Stage3TemplateLab initialTemplateId={params.template ?? null} />;
}
