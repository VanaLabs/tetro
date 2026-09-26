'use client';
import { useId, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
export type LanguageChoice = { code: string; label: string };
export function LanguageChoices({ groups, value, onChange, label }: { groups: { title: string; options: LanguageChoice[] }[]; value: string; onChange: (code: string) => void; label: string }) {
  return <Command aria-label={label}>
    <CommandInput placeholder="Search languages…" aria-label={`Search ${label.toLowerCase()}`} autoFocus />
    <CommandList className="max-h-72"><CommandEmpty>No languages match.</CommandEmpty>
      {groups.filter(g => g.options.length).map(g => <CommandGroup key={g.title} heading={g.title}>{g.options.map(o => <CommandItem key={o.code} value={`${o.label} ${o.code}`} onSelect={() => onChange(o.code)}>
        <Check className={`mr-2 h-4 w-4 ${value === o.code ? 'opacity-100' : 'opacity-0'}`} /><span>{o.label}</span>
      </CommandItem>)}</CommandGroup>)}
    </CommandList>
  </Command>;
}
export function LanguageChooser({ options, value, onChange, disabled, label = 'Spoken language' }: { options: LanguageChoice[]; value: string; onChange: (code: string) => void; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const popupId = useId();
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" className="tetro-language-chooser" role="combobox" aria-label={label} aria-expanded={open} aria-controls={popupId} aria-haspopup="dialog" disabled={disabled}><span>{options.find(o => o.code === value)?.label || 'Choose a language'}</span><ChevronsUpDown className="h-4 w-4" /></button></PopoverTrigger>
    <PopoverContent id={popupId} align="start" className="w-72 p-0"><LanguageChoices label={label} groups={[{ title: label, options }]} value={value} onChange={code => { onChange(code); setOpen(false); }} /></PopoverContent>
  </Popover>;
}
