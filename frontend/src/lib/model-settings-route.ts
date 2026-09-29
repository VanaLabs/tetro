/** Show the local summary choices directly from any in-app prompt. */
export function openSummaryModelChoices(push: (href: string) => void) {
  sessionStorage.setItem('tetro.settingsTab', 'models');
  sessionStorage.setItem('tetro.modelsSection', 'summary');
  sessionStorage.setItem('tetro.browseSummaryModels', '1');
  push('/settings');
}
