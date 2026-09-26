// A convenience cache must never make a successful settings save look like a failure.
export function readProviderModels(): Record<string, string> {
  try { const value = JSON.parse(localStorage.getItem('providerModelMap') || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
export function rememberProviderModel(provider: string, model: string) {
  if (!model) return;
  try { const map = readProviderModels(); map[provider] = model; localStorage.setItem('providerModelMap', JSON.stringify(map)); } catch { /* Optional cache; the database is authoritative. */ }
}
