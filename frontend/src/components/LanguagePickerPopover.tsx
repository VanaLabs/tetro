'use client';
import { LANGUAGE_OPTIONS } from '@/lib/summary-languages';
import { useRecentLanguages } from '@/hooks/useRecentLanguages';
import { LanguageChoices } from '@/components/tetro/LanguageChooser';
interface Props { value: string | null; onChange: (code: string | null) => void; onClose: () => void; mode?: 'meeting' | 'settings'; autoSubtitle?: string }
export function LanguagePickerPopover({ value, onChange, onClose, mode = 'meeting', autoSubtitle }: Props) {
  const { recents } = useRecentLanguages();
  const recent = mode === 'meeting' ? LANGUAGE_OPTIONS.filter(o => recents.includes(o.code)) : [];
  return <div className="w-72 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
    <LanguageChoices label="Summary language" value={value || '__auto__'} onChange={code => { onChange(code === '__auto__' ? null : code); onClose(); }} groups={[
      { title: 'Summary language', options: mode === 'meeting' ? [{ code: '__auto__', label: 'Match the meeting language' }] : [] },
      { title: 'Recently used', options: recent },
      { title: 'Languages', options: LANGUAGE_OPTIONS.filter(o => !recent.includes(o)) },
    ]} />
    {mode === 'meeting' && autoSubtitle && <p className="px-3 py-2 text-xs text-muted-foreground">{autoSubtitle}</p>}
  </div>;
}
