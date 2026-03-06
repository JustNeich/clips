export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function asErrorResponse(error: unknown, fallback: string, status = 500): Response {
  if (error instanceof Response) {
    return error;
  }
  return Response.json({ error: errorMessage(error, fallback) }, { status });
}
