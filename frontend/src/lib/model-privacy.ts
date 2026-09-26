import { PROVIDER_LABELS } from './summaryModel';
export function isDeviceEndpoint(endpoint?: string | null): boolean {
  if (!endpoint?.trim()) return true; // Ollama's default is loopback.
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname.toLowerCase()); }
  catch { return false; }
}
export function notesDestination(provider: string, endpoint?: string | null): string {
  if (provider === 'builtin-ai' || (provider === 'ollama' && isDeviceEndpoint(endpoint))) return 'Stays on this device';
  if (provider === 'ollama' || provider === 'custom-openai') {
    try { return `Sent to ${new URL(endpoint || '').host}`; } catch { return 'Sent to your configured server'; }
  }
  return `Sent to ${PROVIDER_LABELS[provider] || provider}`;
}
