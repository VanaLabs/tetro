/** Translate decoder diagnostics into recovery steps without hiding other errors. */
export function importErrorMessage(error: unknown, fallback = 'Could not import this file. Please try again.'): string {
  const detail = typeof error === 'string' ? error : error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';

  if (/Failed to probe audio format:|No audio samples decoded from file/i.test(detail)) {
    return 'Tetro could not read this file. It may be empty or damaged. Try another audio or video file.';
  }
  if (/No audio track found in file/i.test(detail)) {
    return 'This file has no audio track. Choose an audio file or a video that includes sound.';
  }
  return detail || fallback;
}
