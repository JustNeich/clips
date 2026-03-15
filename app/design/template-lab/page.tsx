import { Stage3TemplateLab } from "../../components/Stage3TemplateLab";
import { TemplateCompareMode } from "../../components/types";
import { listTemplateCalibrationBundles } from "../../../lib/template-calibration-store";

type TemplateLabPageProps = {
  searchParams?: Promise<{ template?: string; mode?: string }>;
};

export default async function TemplateLabPage({ searchParams }: TemplateLabPageProps) {
  const params = (await searchParams) ?? {};
  const bundles = await listTemplateCalibrationBundles();
  const initialMode =
    params.mode === "side-by-side" ||
    params.mode === "overlay" ||
    params.mode === "difference" ||
    params.mode === "split-swipe" ||
    params.mode === "heatmap"
      ? (params.mode as TemplateCompareMode)
      : null;

  return (
    <Stage3TemplateLab
      initialTemplateId={params.template ?? null}
      initialMode={initialMode}
      initialBundles={bundles}
    />
  );
}
