export const EVERYDAY_TEMPLATE_IDS = ['standard_meeting', 'ideas_and_notes', 'team_meeting', 'interview'] as const;

export function isEverydayTemplate(id: string): boolean {
  return EVERYDAY_TEMPLATE_IDS.some(coreId => coreId === id);
}

export function sortTemplates<T extends { id: string; name: string }>(templates: T[]): T[] {
  return [...templates].sort((a, b) => {
    const aIndex = EVERYDAY_TEMPLATE_IDS.findIndex(id => id === a.id);
    const bIndex = EVERYDAY_TEMPLATE_IDS.findIndex(id => id === b.id);
    if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
    if (aIndex >= 0) return -1;
    if (bIndex >= 0) return 1;
    return a.name.localeCompare(b.name);
  });
}
