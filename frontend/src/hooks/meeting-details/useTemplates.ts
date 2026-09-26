import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

type Template = { id: string; name: string; description: string };

export function useTemplates(meetingId?: string) {
  const [availableTemplates, setAvailableTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('standard_meeting');
  const [isTemplateLoading, setIsTemplateLoading] = useState(true);
  const generation = useRef(0);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    const version = ++generation.current;
    setIsTemplateLoading(true);
    setSelectedTemplate('standard_meeting');
    Promise.all([
      invoke<Template[]>('api_list_templates'),
      meetingId ? invoke<{ template_id: string | null }>('api_get_meeting_preferences', { meetingId }) : Promise.resolve(null),
    ]).then(([templates, saved]) => {
      if (version !== generation.current) return;
      setAvailableTemplates(templates);
      if (saved?.template_id && templates.some(t => t.id === saved.template_id)) setSelectedTemplate(saved.template_id);
    }).catch(error => {
      if (version === generation.current) toast.error('Couldn’t load the meeting’s template', { description: String(error) });
    }).finally(() => { if (version === generation.current) setIsTemplateLoading(false); });
    return () => { generation.current++; };
  }, [meetingId]);

  const handleTemplateSelection = useCallback((templateId: string, _templateName: string) => {
    const version = generation.current;
    setIsTemplateLoading(true);
    // Preserve click order even if the person changes their choice before a save finishes.
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (meetingId) await invoke('api_set_meeting_template', { meetingId, templateId });
      if (version === generation.current) setSelectedTemplate(templateId);
    }).catch(error => {
      if (version === generation.current) toast.error('Couldn’t save that template choice', { description: String(error) });
    }).finally(() => { if (version === generation.current) setIsTemplateLoading(false); });
  }, [meetingId]);
  return { availableTemplates, selectedTemplate, handleTemplateSelection, isTemplateLoading };
}
