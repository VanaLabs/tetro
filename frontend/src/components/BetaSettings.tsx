'use client';

import { Switch } from '@/components/ui/switch';
import { useConfig } from '@/contexts/ConfigContext';
import { BETA_FEATURE_DESCRIPTIONS, BETA_FEATURE_NAMES } from '@/types/betaFeatures';
import { SettingGroup, SettingRow } from '@/components/tetro/SettingRow';

/** Settings → Beta: features that work but may still get things wrong. */
export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature } = useConfig();
  return <div className="tetro-settings-stack">
    <p className="tetro-setting-note">Beta features work but can make mistakes. Your meetings are never changed unless you use the feature.</p>
    <SettingGroup title="Transcript">
      <SettingRow label={BETA_FEATURE_NAMES.speakerLabels} hint={BETA_FEATURE_DESCRIPTIONS.speakerLabels}>
        <Switch checked={betaFeatures.speakerLabels} onCheckedChange={on => toggleBetaFeature('speakerLabels', on)} aria-label={BETA_FEATURE_NAMES.speakerLabels} />
      </SettingRow>
    </SettingGroup>
  </div>;
}
