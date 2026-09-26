import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { suggestTemplate, type TemplateText } from '@/lib/suggestTemplate';

let fullTemplates: Promise<TemplateText[]> | null = null;
const loadTemplates = (ids: string[]) => (fullTemplates ??= Promise.all(ids.map(id =>
  invoke<{ id: string; template: Omit<TemplateText, 'id'> }>('api_get_template_full', { templateId: id })
    .then(t => ({ id: t.id, ...t.template })).catch(() => null)))
  .then(list => list.filter(Boolean) as TemplateText[]));

/** Template that clearly fits this transcript, or null. */
export function useTemplateSuggestion(transcriptText: string, templateIds: string[], enabled: boolean) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !transcriptText || templateIds.length < 2) { setSuggestion(null); return; }
    let cancelled = false;
    void loadTemplates(templateIds).then(list => { if (!cancelled) setSuggestion(suggestTemplate(transcriptText, list)?.id ?? null); });
    return () => { cancelled = true; };
  }, [transcriptText, templateIds.join('|'), enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return suggestion;
}

/** Call after templates are created or edited so suggestions use the new wording. */
export function resetTemplateSuggestionCache() { fullTemplates = null; }
