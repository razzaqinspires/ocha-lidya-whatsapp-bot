import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGreetingOnlyInput,
  isSubstantiveUserTurn,
  isGenericNonAnswerResponse,
  buildNonAnswerFallback
} from '../src/ai/response-quality.js';

test('pure greetings remain eligible for the deterministic greeting path', () => {
  assert.equal(isGreetingOnlyInput('halo'), true);
  assert.equal(isGreetingOnlyInput('Assalamualaikum'), true);
  assert.equal(isGreetingOnlyInput('Bagaimana keadaan Gaza hari ini'), false);
});

test('substantive factual questions are distinguished from short acknowledgements', () => {
  assert.equal(isSubstantiveUserTurn('Bagaimana keadaan Gaza hari ini'), true);
  assert.equal(isSubstantiveUserTurn('Kenapa server tidak merespons?'), true);
  assert.equal(isSubstantiveUserTurn('halo'), false);
  assert.equal(isSubstantiveUserTurn('sip'), false);
});

test('generic invitation answers are identified as non-answers', () => {
  assert.equal(isGenericNonAnswerResponse('Apa yang ingin kamu lakukan hari ini?'), true);
  assert.equal(isGenericNonAnswerResponse('Halo. Apa yang ingin kamu lakukan hari ini?'), true);
  assert.equal(isGenericNonAnswerResponse('Mau mulai dari mana?'), true);
  assert.equal(isGenericNonAnswerResponse('Ada yang bisa saya bantu?'), true);
});

test('a substantive response is not blocked by the generic non-answer guard', () => {
  assert.equal(isGenericNonAnswerResponse('Keadaan Gaza perlu dilihat dari laporan kemanusiaan, kondisi akses bantuan, dan perkembangan diplomatik. Saya belum memiliki data real-time untuk memastikan situasi hari ini.'), false);
  assert.equal(isGenericNonAnswerResponse('Berikut tiga penyebab umum koneksi WhatsApp terputus dan cara memeriksanya.'), false);
});

test('time-sensitive Gaza fallback refuses to invent current events and keeps the topic', () => {
  const fallback = buildNonAnswerFallback('Bagaimana keadaan Gaza hari ini');
  assert.match(fallback, /Gaza/i);
  assert.match(fallback, /real-time/i);
  assert.match(fallback, /tidak akan mengarang/i);
  assert.doesNotMatch(fallback, /apa yang ingin kamu lakukan/i);
});

test('generic fallback preserves the user request and does not send a greeting', () => {
  const fallback = buildNonAnswerFallback('Jelaskan perbedaan ESM dan CommonJS');
  assert.match(fallback, /ESM dan CommonJS/);
  assert.doesNotMatch(fallback, /Halo|Hai/i);
});
