'use client';

import { PermissionsSettings } from '@/components/PermissionsSettings';
import { BetaSettings } from '@/components/BetaSettings';
import { StorageSettings } from '@/components/StorageSettings';
import React, { useState, useEffect } from 'react';
import { ArrowLeft, Settings2, Mic, Database as DatabaseIcon, SparkleIcon, Boxes, HardDrive, FlaskConical, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { invoke } from '@tauri-apps/api/core';
import { RecordingSettings } from '@/components/RecordingSettings';
import { PreferenceSettings } from '@/components/PreferenceSettings';
import { SummaryModelSettings } from '@/components/SummaryModelSettings';
import { ModelsSettings, TranscriptionSettings, type ModelsSection } from '@/components/tetro/ModelsSettings';
import { useConfig } from '@/contexts/ConfigContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

// Sections in a left sidebar, each with a short hint. Beta sits apart at the bottom.
const TABS = [
  { value: 'general', label: 'General', hint: 'Appearance, notifications, folder', icon: Settings2 },
  { value: 'recording', label: 'Recordings', hint: 'Audio files, names, shortcuts, devices', icon: Mic },
  { value: 'Transcriptionmodels', label: 'Transcription', hint: 'Model in use, vocabulary', icon: DatabaseIcon },
  { value: 'summaryModels', label: 'Summary', hint: 'Model in use, automatic summaries', icon: SparkleIcon },
  { value: 'models', label: 'Models', hint: 'Download and connect models', icon: Boxes },
  { value: 'permissions', label: 'Permissions', hint: 'Microphone and computer audio access', icon: ShieldCheck },
  { value: 'storage', label: 'Storage', hint: 'Disk space and cleanup', icon: HardDrive },
  { value: 'beta', label: 'Beta', hint: 'Features still being tested', icon: FlaskConical }
] as const;

export default function SettingsPage() {
  const router = useRouter();
  const { setTranscriptModelConfig } = useConfig();

  const [activeTab, setActiveTab] = useState('general');
  const [modelsSection, setModelsSection] = useState<ModelsSection>('transcription');
  const [browseTranscriptionOnOpen, setBrowseTranscriptionOnOpen] = useState(false);
  const [browseSummaryOnOpen, setBrowseSummaryOnOpen] = useState(false);
  const openModels = (section: ModelsSection) => { setModelsSection(section); if (section === 'transcription') setBrowseTranscriptionOnOpen(true); if (section === 'summary') setBrowseSummaryOnOpen(true); setActiveTab('models'); };
  useEffect(() => {
    const tab = sessionStorage.getItem('tetro.settingsTab');
    if (TABS.some(item => item.value === tab)) setActiveTab(tab!);
    const section = sessionStorage.getItem('tetro.modelsSection');
    if (section === 'transcription' || section === 'summary' || section === 'external') setModelsSection(section);
    if (sessionStorage.getItem('tetro.browseTranscriptionModels') === '1') setBrowseTranscriptionOnOpen(true);
    if (sessionStorage.getItem('tetro.browseSummaryModels') === '1') setBrowseSummaryOnOpen(true);
    sessionStorage.removeItem('tetro.settingsTab');
    sessionStorage.removeItem('tetro.modelsSection');
    sessionStorage.removeItem('tetro.browseSummaryModels');
    sessionStorage.removeItem('tetro.browseTranscriptionModels');
  }, []);
  useEffect(() => {
    const choose = (event: Event) => { const tab = (event as CustomEvent).detail; if (TABS.some(item => item.value === tab)) setActiveTab(tab); };
    window.addEventListener('tetro:settings-tab', choose);
    return () => window.removeEventListener('tetro:settings-tab', choose);
  }, []);

  // Load saved transcript configuration on mount
  useEffect(() => {
    const loadTranscriptConfig = async () => {
      try {
        const config = await invoke('api_get_transcript_config') as any;
        if (config) {
          setTranscriptModelConfig({
            provider: config.provider || 'localWhisper',
            model: config.model || 'large-v3',
            apiKey: null
          });
        }
      } catch (error) {
        console.error('Failed to load transcript config:', error);
      }
    };
    loadTranscriptConfig();
  }, [setTranscriptModelConfig]);

  const active = TABS.find(tab => tab.value === activeTab) ?? TABS[0];

  return (
    <div className="tetro-settings h-full min-h-0 bg-gray-50 flex flex-col">
      {/* Fixed Header */}
      <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <h1 className="text-3xl font-bold">Settings</h1>
          </div>
        </div>
      </div>

      {/* Scrollable Content */}
      <div data-settings-scroll className="flex-1 overflow-y-auto" style={{ overflowAnchor: 'none' }}>
        <div className="tetro-settings-sheet">
          <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="tetro-settings-layout">
            <TabsList className="tetro-settings-nav" aria-label="Settings sections">
              {TABS.map(tab => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.value} value={tab.value} className={tab.value === 'beta' ? 'is-apart' : undefined}>
                    <Icon aria-hidden="true" />
                    <span><strong>{tab.label}</strong><small>{tab.hint}</small></span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <div className="tetro-settings-panel">
              <header className="tetro-settings-panel-head"><h2>{active.label}</h2></header>
              <TabsContent value="general">
                <PreferenceSettings />
              </TabsContent>
              <TabsContent value="recording">
                <RecordingSettings />
              </TabsContent>
              <TabsContent value="Transcriptionmodels">
                <TranscriptionSettings onOpenModels={() => openModels('transcription')} />
              </TabsContent>
              <TabsContent value="summaryModels">
                <SummaryModelSettings onOpenModels={() => openModels('summary')} onOpenExternalModels={() => openModels('external')} />
              </TabsContent>
              <TabsContent value="models">
                <ModelsSettings section={modelsSection} onSectionChange={setModelsSection} browseSummaryOnOpen={browseSummaryOnOpen} browseTranscriptionOnOpen={browseTranscriptionOnOpen} />
              </TabsContent>
              <TabsContent value="permissions">
                <PermissionsSettings onOpenModels={() => openModels('external')} />
              </TabsContent>
              <TabsContent value="storage">
                <StorageSettings />
              </TabsContent>
              <TabsContent value="beta">
                <BetaSettings />
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  );
};
