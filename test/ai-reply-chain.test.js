import test from 'node:test';
import assert from 'node:assert/strict';
import { AIReplyChainStore } from '../src/ai/reply-chain.js';

test('AI reply chain resolves root-to-leaf turns through quoted AI message anchors', () => {
  const store = new AIReplyChainStore();
  store.addTurn('job-1', 'user', 'Apa itu Nexora?');
  store.addTurn('job-1', 'assistant', 'Nexora adalah sistem AI.');
  store.addAnchor({ chat: 'chat', messageId: 'answer-1', jobId: 'job-1', threadId: 'thread-1', depth: 0 });
  store.addTurn('job-2', 'user', 'Jelaskan lebih detail.');
  store.addTurn('job-2', 'assistant', 'Berikut penjelasannya.');
  store.addAnchor({ chat: 'chat', messageId: 'answer-2', jobId: 'job-2', parentJobId: 'job-1', threadId: 'thread-1', depth: 1 });

  const context = store.resolve('chat', 'answer-2');
  assert.equal(context.depth, 1);
  assert.equal(context.threadId, 'thread-1');
  assert.deepEqual(context.turns.map(turn => turn.content), [
    'Apa itu Nexora?', 'Nexora adalah sistem AI.', 'Jelaskan lebih detail.', 'Berikut penjelasannya.'
  ]);
});

test('AI reply chain keeps every parent beyond eight replies while selecting only the newest prompt window', () => {
  const store = new AIReplyChainStore({ maxChars: 1200 });
  let parentJobId = null;
  for (let index = 1; index <= 24; index++) {
    const jobId = `job-${index}`;
    store.addTurn(jobId, 'user', `Pertanyaan ${index} ` + 'U'.repeat(80));
    store.addTurn(jobId, 'assistant', `Jawaban ${index} ` + 'A'.repeat(80));
    store.addAnchor({ chat: 'chat', messageId: `answer-${index}`, jobId, parentJobId, threadId: 'thread-long', depth: index - 1 });
    parentJobId = jobId;
  }

  const context = store.resolve('chat', 'answer-24');
  assert.equal(context.jobIds.length, 24);
  assert.equal(context.depth, 23);
  assert.equal(context.threadId, 'thread-long');
  assert.equal(context.turns.at(-1).content.startsWith('Jawaban 24'), true);
  assert.equal(context.turns.some(turn => turn.content.includes('Pertanyaan 24')), true);
  assert.ok(context.turns.reduce((sum, turn) => sum + turn.content.length, 0) <= 1200);
  assert.equal(context.truncated, true);
  assert.equal(store.resolve('other-chat', 'answer-24').anchor, null);
});

test('AI reply chain detects corrupted parent cycles without looping forever', () => {
  const store = new AIReplyChainStore();
  store.addTurn('a', 'user', 'A');
  store.addAnchor({ chat: 'chat', messageId: 'one', jobId: 'a', parentJobId: 'b', depth: 1 });
  store.addTurn('b', 'assistant', 'B');
  store.addAnchor({ chat: 'chat', messageId: 'two', jobId: 'b', parentJobId: 'a', depth: 2 });
  const context = store.resolve('chat', 'two');
  assert.equal(context.jobIds.length, 2);
  assert.deepEqual(context.turns.map(turn => turn.content), ['A', 'B']);
});
