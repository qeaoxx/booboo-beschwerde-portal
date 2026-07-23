import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueNotification } from '../lib/complaints.js';

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              calls.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
}

test('notification enqueue failure is contained and remains pending', async () => {
  const DB = fakeDb();
  const context = {
    env: {
      DB,
      TELEGRAM_NOTIFICATIONS: { async send() { throw new Error('queue unavailable'); } },
    },
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.doesNotReject(() => enqueueNotification(context, 'notification-1', {
      id: 'complaint-1', title: 'Test', category: 'Essen & Trinken', priority: 'normal',
    }));
  } finally {
    console.error = originalError;
  }
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /status = CASE WHEN status = 'sent' THEN status ELSE 'pending'/);
  assert.equal(DB.calls[0].values.at(-1), 'notification-1');
});

test('successful notification enqueue records queued state', async () => {
  const DB = fakeDb();
  const sent = [];
  const context = {
    env: {
      DB,
      TELEGRAM_NOTIFICATIONS: { async send(message) { sent.push(message); } },
    },
  };
  await enqueueNotification(context, 'notification-2', {
    id: 'complaint-2', title: 'Test', category: 'Essen & Trinken', priority: 'urgent',
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].notificationId, 'notification-2');
  assert.match(DB.calls[0].sql, /ELSE 'queued'/);
});
