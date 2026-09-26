'use client';

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type Info = { end?: string | null; model_provider?: string | null; model_name?: string | null };
const WHERE: Record<string, string> = { 'builtin-ai': 'on this device', ollama: 'via Ollama', openai: 'via OpenAI', claude: 'via Anthropic', groq: 'via Groq', openrouter: 'via OpenRouter', 'custom-openai': 'via your endpoint' };

/** Quiet provenance line under a summary: when it was written and by which model. */
export function SummaryFooter({ meetingId, refreshKey }: { meetingId: string; refreshKey: unknown }) {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    let cancelled = false;
    invoke<Info>('api_get_summary', { meetingId }).then(i => { if (!cancelled) setInfo(i); }).catch(() => {});
    return () => { cancelled = true; };
  }, [meetingId, refreshKey]);
  if (!info?.end && !info?.model_name) return null;
  const when = info.end ? new Date(info.end).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const model = info.model_name ? `${info.model_name}${info.model_provider && WHERE[info.model_provider] ? ` ${WHERE[info.model_provider]}` : ''}` : null;
  return <p className="tetro-summary-footer">Summary written{when ? ` ${when}` : ''}{model ? ` · ${model}` : ''}<br />Check names, decisions and dates against the transcript before sharing.</p>;
}
