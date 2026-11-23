import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMessageText } from '../src/lib/message-text.js';

test('extracts plain text and media captions', () => {
  assert.equal(extractMessageText({ conversation: 'hello' }, 'conversation'), 'hello');
  assert.equal(extractMessageText({ extendedTextMessage: { text: 'quoted text' } }, 'extendedTextMessage'), 'quoted text');
  assert.equal(extractMessageText({ imageMessage: { caption: 'photo caption' } }, 'imageMessage'), 'photo caption');
  assert.equal(extractMessageText({ videoMessage: { caption: 'video caption' } }, 'videoMessage'), 'video caption');
  assert.equal(extractMessageText({ documentMessage: { caption: 'document caption' } }, 'documentMessage'), 'document caption');
  assert.equal(extractMessageText({ ptvMessage: { caption: 'video note caption' } }, 'ptvMessage'), 'video note caption');
});

test('extracts event name, description and Jakarta-local start time', () => {
  const body = extractMessageText({ eventMessage: {
    name: 'Rapat', description: 'Agenda mingguan', startTime: Math.floor(Date.UTC(2026, 10, 20, 3, 0, 0) / 1000)
  } }, 'eventMessage');
  assert.match(body, /Rapat/);
  assert.match(body, /Agenda mingguan/);
  assert.match(body, /Waktu:/);
});

test('extracts poll question and options', () => {
  assert.equal(extractMessageText({ pollCreationMessage: {
    name: 'Pilih jadwal', options: [{ optionName: 'Senin' }, { optionName: 'Selasa' }]
  } }, 'pollCreationMessage'), 'Pilih jadwal\n1. Senin\n2. Selasa');
});

test('extracts native-flow response identifiers with safe JSON parsing', () => {
  assert.equal(extractMessageText({ interactiveResponseMessage: {
    nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: '{"id":"choice-1"}' }
  } }, 'interactiveResponseMessage'), 'choice-1');
  assert.equal(extractMessageText({ interactiveResponseMessage: {
    nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: '{bad json' }
  } }, 'interactiveResponseMessage'), 'quick_reply');
});

test('extracts template, button and list response values', () => {
  assert.equal(extractMessageText({ templateButtonReplyMessage: { selectedId: 'template-1' } }, 'templateButtonReplyMessage'), 'template-1');
  assert.equal(extractMessageText({ buttonsResponseMessage: { selectedButtonId: 'button-1' } }, 'buttonsResponseMessage'), 'button-1');
  assert.equal(extractMessageText({ listResponseMessage: { singleSelectReply: { selectedRowId: 'row-1' } } }, 'listResponseMessage'), 'row-1');
});

test('extracts readable parts of rich responses', () => {
  assert.equal(extractMessageText({ richResponseMessage: { submessages: [
    { messageText: 'Summary' },
    { tableMetadata: { title: 'Metrics' } },
    { codeMetadata: { codeBlocks: [{ codeContent: 'const n = 1;' }] } }
  ] } }, 'richResponseMessage'), 'Summary\n[Tabel: Metrics]\nconst n = 1;');
});

test('extracts nested native-flow identifiers and keeps all response parameters', async () => {
  const { parseNativeFlowResponse } = await import('../src/lib/message-text.js');
  const source = {
    nativeFlowResponseMessage: {
      name: 'single_select',
      version: 3,
      paramsJson: JSON.stringify({ response: { row_id: 'command-row', extra_field: 'preserved' }, screen: 'BOOKING' })
    }
  };
  const response = parseNativeFlowResponse(source);
  assert.equal(response.name, 'single_select');
  assert.equal(response.version, 3);
  assert.equal(response.selectedId, 'command-row');
  assert.equal(response.selectedRowId, 'command-row');
  assert.equal(response.params.screen, 'BOOKING');
  assert.equal(response.params.response.extra_field, 'preserved');
});

test('extracts interactive business message body and media caption', () => {
  assert.equal(extractMessageText({ interactiveMessage: {
    header: { title: 'Native Flow', subtitle: 'Subtitle', imageMessage: { caption: 'Image caption' } },
    body: { text: 'Interactive body' }
  } }, 'interactiveMessage'), 'Native Flow\nSubtitle\nInteractive body\nImage caption');
});
