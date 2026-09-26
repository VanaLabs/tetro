'use client';

import { SettingGroup, SettingRow } from '@/components/tetro/SettingRow';
import { SummaryModelPicker } from '@/components/tetro/SummaryModelPicker';
import { SummaryLanguageSettings } from '@/components/SummaryLanguageSettings';
import { AutomaticNamesSetting } from '@/components/tetro/AutomaticNamesSetting';
import { Switch } from './ui/switch';
import { useConfig } from '@/contexts/ConfigContext';

/** Settings → Summary: which model writes summaries, and when. Downloads and provider keys live in Models. */
export function SummaryModelSettings({ onOpenModels, onOpenExternalModels }: { onOpenModels: () => void; onOpenExternalModels: () => void }) {
  const { isAutoSummary, toggleIsAutoSummary } = useConfig();

  return (
    <div className="tetro-settings-stack">
      <SettingGroup title="Model">
        <SettingRow label="Summary model" hint={<>Writes summaries and drafts templates. <button type="button" className="tetro-link" onClick={onOpenModels}>Browse local models</button> · <button type="button" className="tetro-link" onClick={onOpenExternalModels}>Connect an external model</button></>}>
          <SummaryModelPicker onGetMore={onOpenModels} />
        </SettingRow>
      </SettingGroup>

      <SettingGroup title="Summaries">
        <AutomaticNamesSetting />
        <SettingRow label="Summarize automatically" hint="Start the summary as soon as a recording stops.">
          <Switch checked={isAutoSummary} onCheckedChange={toggleIsAutoSummary} aria-label="Summarize automatically" />
        </SettingRow>
        <SummaryLanguageSettings />
      </SettingGroup>
    </div>
  );
}
