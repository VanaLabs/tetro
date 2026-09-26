import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

mock.module('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
let tick: (() => void) | null = null;
const media = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
Object.assign(globalThis, {
  matchMedia: () => media,
  window: { setInterval: (callback: () => void) => { tick = callback; return 1; }, clearInterval: () => { tick = null; } },
});

const { default: Help } = await import('../../src/app/help/page');
let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType('button').find(b => b.children.some(c => c === label))!;
const caption = () => view.root.findByProps({ className: 'tetro-guide-caption' }).findByType('h3').children.join('');
const image = () => view.root.findByProps({ className: 'tetro-guide-image' }).findAllByType('img').find(i => !i.props['aria-hidden'])!;

afterEach(async () => {
  await act(async () => view?.unmount());
  tick = null;
  media.matches = false;
});

test('each step stays in place until Back or Next is pressed', async () => {
  await act(async () => { view = create(<Help />); });
  expect(caption()).toBe('Choose your audio devices');
  expect(tick).toBeNull();
  expect(button('Back').props.disabled).toBe(true);
  expect(button('Next').props.disabled).toBe(false);
  expect(view.root.findAllByProps({ className: 'tetro-guide-controls' })[0].findAllByType('button').length).toBe(2);
  expect(image().props.src).toContain('audio-devices.jpg');
  await act(async () => button('Next').props.onClick());
  expect(caption()).toBe('Choose the spoken language');
  await act(async () => button('Back').props.onClick());
  expect(caption()).toBe('Choose your audio devices');
});

test('real screen states loop on a supported step and stop on topic switch', async () => {
  await act(async () => { view = create(<Help />); });
  await act(async () => button('Next').props.onClick());
  await act(async () => button('Next').props.onClick());
  expect(caption()).toBe('Begin the recording');
  expect(image().props.src).toContain('recording-ready.jpg');
  expect(tick).not.toBeNull();
  expect(view.root.findByProps({ className: 'tetro-guide-image' }).findAllByType('img').length).toBe(2);
  await act(async () => tick?.());
  expect(image().props.src).toContain('recording-live.jpg');
  await act(async () => button('Import').props.onClick());
  expect(caption()).toBe('Choose a file');
  expect(button('Back').props.disabled).toBe(true);
  expect(image().props.src).toContain('import-options.jpg');
  expect(tick).toBeNull();
});

test('transcript editing holds on the useful editor screen without flickering', async () => {
  await act(async () => { view = create(<Help />); });
  await act(async () => button('Transcript').props.onClick());
  await act(async () => button('Next').props.onClick());
  expect(caption()).toBe('Correct a line');
  expect(image().props.src).toContain('transcript-edit.jpg');
  expect(tick).toBeNull();
});

test('reduced motion keeps the first real screen visible', async () => {
  media.matches = true;
  await act(async () => { view = create(<Help />); });
  await act(async () => button('Next').props.onClick());
  await act(async () => button('Next').props.onClick());
  expect(image().props.src).toContain('recording-ready.jpg');
  expect(tick).toBeNull();
  expect(button('Next')).toBeDefined();
});
