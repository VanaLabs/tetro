import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyStateSummary } from '../../src/components/EmptyStateSummary';

describe('empty summary state', () => {
  test('renders a persistent retryable error', () => {
    const html = renderToStaticMarkup(
      <EmptyStateSummary
        error="Summary request failed"
        hasModel
        onGenerate={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Summary request failed');
    expect(html).toContain('Try again');
  });
});

test('no transcript offers no summary action', () => {
  const html = renderToStaticMarkup(<EmptyStateSummary hasModel hasTranscript={false} onGenerate={() => {}} />);
  expect(html).toContain('Transcribe the recording first');
  expect(html).not.toContain('<button');
});
