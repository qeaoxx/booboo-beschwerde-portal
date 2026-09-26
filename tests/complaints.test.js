import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPhotos, complaintFromRow, deleteKvKeys } from '../lib/complaints.js';

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          return { setting_value: '6' };
        },
        async run() {
          calls.push({ sql, values: this.values });
          return { success: true };
        },
      };
    },
  };
}

test('complaint rows map to the shared dashboard model', () => {
  const complaint = complaintFromRow({
    id: 'c-1',
    title: 'Die letzte Pommes',
    details: 'Sie wurde geteilt — ohne zu fragen.',
    category: 'Essen & Trinken',
    mood: '😤',
    status: 'new',
    priority: null,
    created_at: '2026-07-23T08:00:00.000Z',
    version: 2,
  });
  assert.equal(complaint.title, 'Die letzte Pommes');
  assert.equal(complaint.priority, null);
  assert.equal(complaint.version, 2);
  assert.equal(complaint.updatedAt, complaint.createdAt);
  assert.equal('notification' in complaint, false);
});

test('photos attach to their complaint with private metadata only', () => {
  const complaints = [{ id: 'c-1' }, { id: 'c-2' }];
  attachPhotos(complaints, [
    { id: 'p-1', complaint_id: 'c-1', filename: 'bild.jpg', content_type: 'image/jpeg', size: 120, thumbnail_storage_key: 'thumb' },
    { id: 'p-2', complaint_id: 'missing', filename: 'orphan.jpg', content_type: 'image/jpeg', size: 50 },
  ]);
  assert.equal(complaints[0].photos.length, 1);
  assert.equal(complaints[0].photos[0].hasThumbnail, true);
  assert.deepEqual(complaints[1].photos, []);
});

test('failed private photo deletion is scheduled for reliable retry', async () => {
  const DB = fakeDb();
  const oldError = console.error;
  console.error = () => {};
  try {
    await deleteKvKeys({
      DB,
      PHOTOS: { async delete() { throw new Error('temporary storage error'); } },
    }, [{ key: 'complaints/c-1/photo', kind: 'photo' }]);
  } finally {
    console.error = oldError;
  }
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /INSERT INTO cleanup_jobs/);
  assert.equal(DB.calls[0].values[0], 'complaints/c-1/photo');
});

test('successful private photo deletion clears any pending retry', async () => {
  const DB = fakeDb();
  await deleteKvKeys({
    DB,
    PHOTOS: { async delete() {} },
  }, [{ key: 'complaints/c-1/photo', kind: 'photo' }]);
  assert.equal(DB.calls.length, 1);
  assert.match(DB.calls[0].sql, /DELETE FROM cleanup_jobs/);
});
