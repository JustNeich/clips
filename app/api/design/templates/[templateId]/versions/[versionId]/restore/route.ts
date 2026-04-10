export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  return Response.json(
    { error: "Template versions are no longer supported." },
    { status: 410 }
  );
}
