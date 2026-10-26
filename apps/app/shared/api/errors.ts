/** Convert validation errors into actionable copy rather than a JSON dump. */
export function errorMessage(error: unknown): string {
 if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) {
  const first = error.issues[0];
  if (typeof first?.message === 'string') return first.message;
 }
 return error instanceof Error ? error.message : 'No se pudo completar la operación';
}
