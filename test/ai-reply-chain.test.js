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

test('AI reply chain is bounded by depth and total context characters', () => {
  const store = new AIReplyChainStore({ maxDepth: 2, maxChars: 1000 });
  store.addTurn('job-1', 'user', 'A'.repeat(600));
  store.addTurn('job-1', 'assistant', 'B'.repeat(600));
  store.addAnchor({ chat: 'chat', messageId: 'answer-1', jobId: 'job-1', threadId: 'thread-1', depth: 0 });
  store.addTurn('job-2', 'user', 'Second prompt');
  store.addTurn('job-2', 'assistant', 'Second answer');
  store.addAnchor({ chat: 'chat', messageId: 'answer-2', jobId: 'job-2', parentJobId: 'job-1', threadId: 'thread-1', depth: 1 });
  store.addTurn('job-3', 'user', 'Third prompt');
  store.addTurn('job-3', 'assistant', 'Third answer');
  store.addAnchor({ chat: 'chat', messageId: 'answer-3', jobId: 'job-3', parentJobId: 'job-2', threadId: 'thread-1', depth: 2 });

  const context = store.resolve('chat', 'answer-3');
  assert.ok(context.turns.length <= 4);
  assert.ok(context.turns.reduce((sum, turn) => sum + turn.content.length, 0) <= 1000);
  assert.equal(store.resolve('other-chat', 'answer-3').anchor, null);
});
