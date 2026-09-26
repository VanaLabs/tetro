'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SettingRow } from '@/components/tetro/SettingRow';
import { useConfirm } from '@/components/tetro/useConfirm';
import { useOllamaDownload } from '@/contexts/OllamaDownloadContext';
import { isDeviceEndpoint, notesDestination } from '@/lib/model-privacy';
import { listen } from '@tauri-apps/api/event';
import { activateNotesModel, requestModelActivation, activateDownloadedModel, cancelModelActivation } from '@/lib/model-activation';
import { loadSummaryModel, saveSummaryModel } from '@/lib/summaryModel';

type OllamaModel = { name: string; size: string };

/** Ollama on this device: what's installed, add a model by name, remove one, and where Ollama listens. */
export function OllamaModels() {
  const { downloadingModels, getProgress } = useOllamaDownload();
  const { confirm, dialog } = useConfirm();
  const [models, setModels] = useState<OllamaModel[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [endpoint, setEndpoint] = useState('');
  const [savedEndpoint, setSavedEndpoint] = useState('');
  const [inUse, setInUse] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [pulling, setPulling] = useState(false);
  const selectModel = async (model: string) => {
    try { await activateNotesModel({ provider: 'ollama', model }); setInUse(model); }
    catch (error) { toast.error('Couldn’t switch models', { description: String(error) }); }
  };
  useEffect(() => {
    let disposed = false; let off: (() => void) | undefined;
    void listen<{ provider: string; model: string }>('model-config-updated', e => setInUse(e.payload.provider === 'ollama' ? e.payload.model : null)).then(fn => { if (disposed) fn(); else off = fn; });
    return () => { disposed = true; off?.(); };
  }, []);

  const refresh = useCallback(async (address: string) => {
    try {
      setModels(await invoke<OllamaModel[]>('get_ollama_models', { endpoint: address.trim() || null }));
      setOffline(false);
    } catch {
      setModels([]); setOffline(true);
    }
  }, []);

  useEffect(() => {
    loadSummaryModel().then(c => {
      const address = c?.ollamaEndpoint || '';
      setEndpoint(address); setSavedEndpoint(address);
      setInUse(c?.provider === 'ollama' ? c.model : null);
      void refresh(address);
    }).catch(() => void refresh(''));
  }, [refresh]);

  // A finished download shows up in the installed list.
  const downloading = Array.from(downloadingModels);
  useEffect(() => { if (!downloading.length && models) void refresh(savedEndpoint); }, [downloading.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const pull = async () => {
    const name = draft.trim();
    if (!name || pulling) return;
    setPulling(true);
    requestModelActivation('ollama', name);
    setDraft('');
    try {
      await invoke('pull_ollama_model', { modelName: name, endpoint: savedEndpoint.trim() || null });
      await refresh(savedEndpoint);
      await activateDownloadedModel('ollama', name);
    } catch (e) {
      cancelModelActivation('ollama', name);
      toast.error(`Couldn’t download ${name}`, { description: String(e) });
    } finally { setPulling(false); }
  };
  const remove = async (name: string) => {
    if (!await confirm({ title: `Remove ${name}?`, body: `${inUse === name ? 'Currently used for summaries. ' : ''}Removes it from ${isDeviceEndpoint(savedEndpoint) ? 'this device' : savedEndpoint}. You can download it again.`, confirm: 'Delete' })) return;
    try {
      await invoke('delete_ollama_model', { modelName: name, endpoint: savedEndpoint.trim() || null });
      await refresh(savedEndpoint);
    } catch (e) {
      toast.error(`Couldn’t remove ${name}`, { description: String(e) });
    }
  };
  const saveEndpoint = async () => {
    const address = endpoint.trim();
    if (address && !/^https?:\/\//.test(address)) { toast.error('The address must start with http:// or https://'); return; }
    try {
      await saveSummaryModel({ ollamaEndpoint: address || null });
      setSavedEndpoint(address);
      void refresh(address);
    } catch (e) {
      toast.error('Couldn’t save the address', { description: String(e) });
    }
  };

  return <>
    {dialog}
    <SettingRow label="Ollama" hint={offline
      ? <>Can’t reach Ollama{savedEndpoint ? ` at ${savedEndpoint}` : ' on this device'}. <button type="button" className="tetro-link" onClick={() => invoke('open_external_url', { url: 'https://ollama.com/download' })}>Get Ollama</button></>
      : <>{notesDestination('ollama', savedEndpoint)}. Add a model from the Ollama library by name.</>}>
      <button type="button" className="tetro-key" onClick={() => refresh(savedEndpoint)}>Check again</button>
    </SettingRow>
    {!offline && <div className="tetro-model-rows tetro-model-rows--nested">
      {models?.map(m => (
        <div key={m.name} className="tetro-model-row" data-ready>
          <div className="tetro-model-row-text"><span className="tetro-model-row-name">{m.name}{inUse === m.name && <em className="tetro-tag">In use</em>}</span></div>
          <div className="tetro-model-specs"><span className="tetro-model-size">{m.size}</span></div>
          <div className="tetro-model-row-action">
            <button type="button" className="tetro-key" disabled={inUse === m.name} onClick={() => void selectModel(m.name)}>{inUse === m.name ? 'In use' : 'Use'}</button>
            <button type="button" className="tetro-model-remove" onClick={() => remove(m.name)} title={`Remove ${m.name}`} aria-label={`Remove ${m.name}`}><Trash2 className="h-4 w-4" /></button>
          </div>
        </div>
      ))}
      {downloading.map(name => (
        <div key={name} className="tetro-model-row">
          <div className="tetro-model-row-text"><span className="tetro-model-row-name">{name}</span></div>
          <div className="tetro-model-row-action">
            <span className="tetro-model-progress" role="progressbar" aria-valuenow={Math.round(getProgress(name) ?? 0)} aria-label={`Downloading ${name}`}><i style={{ width: `${Math.max(2, getProgress(name) ?? 0)}%` }} /></span>
            <span className="tetro-model-pct">{Math.round(getProgress(name) ?? 0)}%</span>
          </div>
        </div>
      ))}
      {models && !models.length && !downloading.length && <p className="tetro-setting-note">No Ollama models yet.</p>}
      <form className="tetro-key-form tetro-ollama-add" onSubmit={e => { e.preventDefault(); void pull(); }}>
        <Input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Model name, e.g. gemma3:4b" aria-label="Ollama model to download" spellCheck={false} />
        <button type="submit" className="tetro-key" disabled={!draft.trim() || pulling}>{pulling ? 'Downloading…' : 'Download and use'}</button>
      </form>
    </div>}
    <div className="tetro-more">
      <h4 className="tetro-setting-label">Ollama address</h4>
      <p className="tetro-setting-note">Leave this blank when Ollama runs on this device. A remote address sends transcript text to that server when you create a summary.</p>
      <form className="tetro-key-form" onSubmit={e => { e.preventDefault(); void saveEndpoint(); }}>
        <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="http://localhost:11434" aria-label="Ollama address" spellCheck={false} />
        <button type="submit" className="tetro-key" disabled={endpoint.trim() === savedEndpoint.trim()}>Save</button>
      </form>
    </div>
  </>;
}

type CustomConfig = { endpoint?: string; model?: string; apiKey?: string | null; maxTokens?: number | null; temperature?: number | null; topP?: number | null; displayName?: string | null };

/** Any OpenAI-compatible server: address, model name and optional key, with a connection test. */
export function CustomServer() {
  const [saved, setSaved] = useState<CustomConfig | null>(null);
  const [form, setForm] = useState({ endpoint: '', model: '', apiKey: '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);

  useEffect(() => {
    invoke<CustomConfig | null>('api_get_custom_openai_config').then(c => {
      setSaved(c?.endpoint ? c : null);
      setForm({ endpoint: c?.endpoint || '', model: c?.model || '', apiKey: c?.apiKey || '' });
    }).catch(() => setSaved(null));
  }, []);

  const valid = /^https?:\/\//.test(form.endpoint.trim()) && !!form.model.trim();
  const args = () => ({ endpoint: form.endpoint.trim(), apiKey: form.apiKey.trim() || null, model: form.model.trim() });
  const test = async () => {
    setBusy('test');
    try {
      const r = await invoke<{ message?: string }>('api_test_custom_openai_connection', args());
      toast.success(r?.message || 'The server answered');
    } catch (e) {
      toast.error('The server didn’t answer', { description: String(e) });
    } finally { setBusy(null); }
  };
  const save = async () => {
    setBusy('save');
    try {
      const next = { ...args(), maxTokens: saved?.maxTokens ?? null, temperature: saved?.temperature ?? null, topP: saved?.topP ?? null };
      await invoke('api_save_custom_openai_config', next);
      setSaved(next); setEditing(false);
    } catch (e) {
      toast.error('Couldn’t save the custom server', { description: String(e) });
    } finally { setBusy(null); }
  };
  const remove = async () => {
    try {
      await invoke('api_delete_api_key', { provider: 'custom-openai' });
      setSaved(null); setForm({ endpoint: '', model: '', apiKey: '' });
    } catch (e) {
      toast.error('Couldn’t remove the custom server', { description: String(e) });
    }
  };

  const label = <span className="tetro-provider-name"><i className={saved ? 'is-on' : ''} aria-hidden="true" />Custom server</span>;
  if (saved && !editing) {
    return <SettingRow label={label} hint={<>Any OpenAI-compatible server. <code className="tetro-key-mask">{saved.model} · {saved.endpoint}</code></>}>
      <button type="button" className="tetro-key" onClick={() => setEditing(true)}>Edit</button>
      <button type="button" className="tetro-key" onClick={remove}>Remove</button>
    </SettingRow>;
  }
  return <div className="tetro-setting-row tetro-setting-row--stack">
    <div className="tetro-setting-text">
      <span className="tetro-setting-label">{label}</span>
      <p>Any OpenAI-compatible server, such as LM Studio, vLLM or a company gateway.</p>
    </div>
    <form className="tetro-custom-server" onSubmit={e => { e.preventDefault(); if (valid) void save(); }}>
      <Input value={form.endpoint} onChange={e => setForm({ ...form, endpoint: e.target.value })} placeholder="Address, e.g. http://localhost:8000/v1" aria-label="Server address" spellCheck={false} />
      <Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Model name" aria-label="Model name" spellCheck={false} />
      <Input type="password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} placeholder="API key (optional)" aria-label="API key" autoComplete="off" />
      <div className="tetro-custom-server-actions">
        <button type="button" className="tetro-key" disabled={!valid || !!busy} onClick={test}>{busy === 'test' ? 'Testing…' : 'Test'}</button>
        <button type="submit" className="tetro-key" disabled={!valid || !!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
        {editing && <button type="button" className="tetro-key" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
    </form>
  </div>;
}
