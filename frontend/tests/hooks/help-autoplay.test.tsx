import React from 'react';
import { afterEach, expect, mock, test } from 'bun:test';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

mock.module('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
const { default: Help } = await import('../../src/app/help/page');
let view: ReactTestRenderer;
const button = (label: string) => view.root.findAllByType('button').find(b => b.children.some(c => c === label))!;
const caption = () => view.root.findByProps({ className: 'tetro-guide-caption' }).findByType('h3').children.join('');

afterEach(async () => { await act(async () => view?.unmount()); });

test('Help keeps each step visible until Back, Next or a topic is chosen', async () => {
  await act(async () => { view = create(<Help />); });
  expect(caption()).toBe('Choose your audio devices');
  expect(button('Back').props.disabled).toBe(true);
  expect(view.root.findAllByType('img')).toHaveLength(0);
  await act(async () => button('Next').props.onClick());
  expect(caption()).toBe('Choose the spoken language');
  await act(async () => button('Back').props.onClick());
  expect(caption()).toBe('Choose your audio devices');
  await act(async () => button('Import').props.onClick());
  expect(caption()).toBe('Choose a file');
});

test('Help calls the generated result a summary', async () => {
  await act(async () => { view = create(<Help />); });
  await act(async () => button('Summaries').props.onClick());
  expect(view.root.findByProps({ className: 'tetro-guide-heading' }).findByType('h2').children.join('')).toBe('Write summaries');
  expect(caption()).toBe('Choose the right structure');
  expect(JSON.stringify(view.toJSON())).toContain('Write summary');
});
