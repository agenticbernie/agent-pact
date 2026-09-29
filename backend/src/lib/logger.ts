/**
 * Structured lifecycle logging. Never log secrets (API keys, private keys, seed phrases).
 */
export function logEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}
