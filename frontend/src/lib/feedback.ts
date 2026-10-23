const FEEDBACK_URL = 'https://github.com/VanaLabs/tetro/issues/new/choose';

/** Only the public app version accompanies the user to GitHub. */
export function feedbackUrl(version?: string | null): string {
  const url = new URL(FEEDBACK_URL);
  if (version && /^\d+\.\d+\.\d+(?:-[\da-z.-]+)?(?:\+[\da-z.-]+)?$/i.test(version)) {
    url.searchParams.set('app-version', version);
  }
  return url.toString();
}
