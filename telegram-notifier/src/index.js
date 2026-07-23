const encoder = new TextEncoder();
const PORTAL_URL = 'https://booboo-portal.pages.dev/#admin';
const MAX_ATTEMPTS = 100;

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS notification_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notification_deliveries (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent')),
    telegram_message_id TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS complaint_state (
    complaint_id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    heard_at TEXT,
    resolved_at TEXT,
    deleted_at TEXT,
    response_text TEXT,
    resolution_text TEXT,
    due_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS complaint_events (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS photo_derivatives (
    photo_id TEXT PRIMARY KEY,
    thumbnail_storage_key TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES complaint_photos(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS notification_outbox (
    id TEXT PRIMARY KEY,
    complaint_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    telegram_message_id TEXT,
    last_error TEXT,
    queued_at TEXT,
    last_attempt_at TEXT,
    sent_at TEXT,
    failed_at TEXT,
    last_synced_status TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS cleanup_jobs (
    storage_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('photo', 'thumbnail', 'orphan')),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    last_attempt_at TEXT
  )`,
];

function response(message, status = 200) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields }));
}

function logError(event, error, fields = {}) {
  console.error(JSON.stringify({
    event,
    error: String(error?.message || error).slice(0, 700),
    timestamp: new Date().toISOString(),
    ...fields,
  }));
}

async function secretMatches(received, expected) {
  if (!received || !expected) return false;
  const [leftBuffer, rightBuffer] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(leftBuffer);
  const right = new Uint8Array(rightBuffer);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] || 0) ^ (right[index] || 0);
  }
  return difference === 0;
}

async function ensureSchema(env) {
  try {
    const version = await env.DB.prepare(
      `SELECT setting_value FROM notification_settings WHERE setting_key = 'schema_version'`,
    ).first();
    if (version?.setting_value === '5') return;
  } catch {
    // The compatibility table is created below on databases that predate notifications.
  }
  await env.DB.batch(SCHEMA_STATEMENTS.map((statement) => env.DB.prepare(statement)));
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO complaint_state (complaint_id, updated_at)
     SELECT id, COALESCE(created_at, ?) FROM complaints`,
  ).bind(now).run();
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_outbox
       (id, complaint_id, status, telegram_message_id, last_error, created_at, sent_at)
       SELECT legacy.id, legacy.complaint_id, CASE WHEN legacy.status = 'sent' THEN 'sent' ELSE 'pending' END,
              legacy.telegram_message_id, legacy.last_error, legacy.created_at, legacy.sent_at
       FROM notification_deliveries legacy
       JOIN complaints c ON c.id = legacy.complaint_id`,
    ).run();
    await env.DB.prepare(
      `UPDATE notification_outbox
       SET status = 'sent',
           telegram_message_id = COALESCE(telegram_message_id, (SELECT telegram_message_id FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id)),
           sent_at = COALESCE(sent_at, (SELECT sent_at FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id))
       WHERE id IN (SELECT id FROM notification_deliveries WHERE status = 'sent')`,
    ).run();
  } catch {
    // A fresh local database may not have the compatibility table yet.
  }
  await env.DB.prepare(
    `INSERT INTO notification_settings (setting_key, setting_value, updated_at)
     VALUES ('schema_version', '5', ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`,
  ).bind(new Date().toISOString()).run();
}

async function telegram(env, method, body) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token is not configured.');
  const result = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await result.json().catch(() => null);
  if (!result.ok || !payload?.ok) throw new Error(`Telegram ${method} failed (${result.status}).`);
  return payload.result;
}

function priorityLabel(priority) {
  return ({ low: 'Entspannt', normal: 'Normal', high: 'Wichtig', urgent: 'Dringend' })[priority] || '';
}

function statusLabel(status) {
  return ({ new: 'Neu', heard: 'Gehört', resolved: 'Erledigt' })[status] || 'Neu';
}

function notificationText(row) {
  const icon = row.status === 'resolved' ? '✅' : row.status === 'heard' ? '👂' : '💌';
  const lines = [
    `${icon} Booboo-Beschwerde · ${statusLabel(row.status)}`,
    '',
    `Kategorie: ${row.category || 'Andere Angelegenheit'}`,
    `Titel: ${row.title || 'Ohne Titel'}`,
  ];
  const priority = priorityLabel(row.priority);
  if (priority) lines.push(`Priorität: ${priority}`);
  lines.push('', 'Im privaten Dashboard anschauen:');
  return lines.join('\n');
}

function inlineKeyboard(row) {
  const statusButtons = [];
  if (row.status !== 'heard') statusButtons.push({ text: 'Gehört 👂', callback_data: `status|${row.complaint_id}|heard` });
  if (row.status !== 'resolved') statusButtons.push({ text: 'Erledigt ✅', callback_data: `status|${row.complaint_id}|resolved` });
  const rows = [];
  if (statusButtons.length) rows.push(statusButtons);
  rows.push([{ text: 'Dashboard öffnen 💗', url: PORTAL_URL }]);
  return { inline_keyboard: rows };
}

async function pairedChatId(env) {
  const row = await env.DB.prepare(
    `SELECT setting_value FROM notification_settings WHERE setting_key = 'telegram_chat_id'`,
  ).first();
  return row?.setting_value || null;
}

async function loadDelivery(env, notificationId) {
  return env.DB.prepare(
    `SELECT n.id, n.complaint_id, n.status AS delivery_status, n.attempt_count,
            n.telegram_message_id, n.last_error, n.last_synced_status,
            c.title, c.category, c.priority, c.status, s.deleted_at
     FROM notification_outbox n
     JOIN complaints c ON c.id = n.complaint_id
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     WHERE n.id = ?`,
  ).bind(notificationId).first();
}

async function deliver(messageBody, env) {
  const notificationId = typeof messageBody?.notificationId === 'string' ? messageBody.notificationId : '';
  if (!notificationId) throw new Error('Notification id is missing.');
  await ensureSchema(env);
  const row = await loadDelivery(env, notificationId);
  if (!row) return;
  if (row.deleted_at || row.delivery_status === 'cancelled') {
    await env.DB.prepare(`UPDATE notification_outbox SET status = 'cancelled' WHERE id = ?`).bind(notificationId).run();
    return;
  }
  if (row.delivery_status === 'sent') return;

  const chatId = await pairedChatId(env);
  if (!chatId) throw new Error('Telegram recipient has not been paired yet.');
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE notification_outbox
     SET status = 'sending', attempt_count = attempt_count + 1, last_attempt_at = ?, last_error = NULL
     WHERE id = ? AND status NOT IN ('sent', 'cancelled')`,
  ).bind(now, notificationId).run();

  const sent = await telegram(env, 'sendMessage', {
    chat_id: chatId,
    text: notificationText(row),
    reply_markup: inlineKeyboard(row),
    link_preview_options: { is_disabled: true },
  });
  const sentAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE notification_outbox
       SET status = 'sent', telegram_message_id = ?, sent_at = ?, last_error = NULL,
           failed_at = NULL, last_synced_status = ?
       WHERE id = ?`,
    ).bind(String(sent.message_id || ''), sentAt, row.status, notificationId),
    env.DB.prepare(
      `UPDATE notification_deliveries
       SET status = 'sent', telegram_message_id = ?, sent_at = ?, last_error = NULL
       WHERE id = ?`,
    ).bind(String(sent.message_id || ''), sentAt, notificationId),
  ]);
  log('telegram_notification_sent', { notificationId, complaintId: row.complaint_id });
}

async function handlePairing(message, env) {
  const chatId = message?.chat?.id;
  const isPrivateChat = message?.chat?.type === 'private';
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  const expectedStart = `/start ${env.TELEGRAM_PAIRING_CODE || ''}`;
  if (!chatId || !isPrivateChat || !env.TELEGRAM_PAIRING_CODE || text !== expectedStart) return;

  const current = await pairedChatId(env);
  if (!current) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO notification_settings (setting_key, setting_value, updated_at)
       VALUES ('telegram_chat_id', ?, ?)`,
    ).bind(String(chatId), now).run();
    await telegram(env, 'sendMessage', {
      chat_id: chatId,
      text: '💗 Verbunden! Neue Beschwerden landen ab jetzt sicher hier.',
    });
    log('telegram_paired', { paired: true });
  } else if (String(current) === String(chatId)) {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: '💗 Die Verbindung ist bereits aktiv.' });
  }
}

async function handleCallback(callback, env) {
  const callbackId = callback?.id;
  const chatId = callback?.message?.chat?.id;
  const messageId = callback?.message?.message_id;
  const data = typeof callback?.data === 'string' ? callback.data : '';
  const [action, complaintId, nextStatus] = data.split('|');
  const paired = await pairedChatId(env);
  if (!callbackId || String(chatId) !== String(paired) || action !== 'status' || !['heard', 'resolved'].includes(nextStatus)) {
    if (callbackId) await telegram(env, 'answerCallbackQuery', { callback_query_id: callbackId, text: 'Aktion nicht erlaubt.' }).catch(() => undefined);
    return;
  }

  const row = await env.DB.prepare(
    `SELECT c.id AS complaint_id, c.title, c.category, c.priority, c.status, s.deleted_at
     FROM complaints c LEFT JOIN complaint_state s ON s.complaint_id = c.id WHERE c.id = ?`,
  ).bind(complaintId).first();
  if (!row || row.deleted_at) {
    await telegram(env, 'answerCallbackQuery', { callback_query_id: callbackId, text: 'Diese Beschwerde existiert nicht mehr.' });
    return;
  }

  const now = new Date().toISOString();
  const heardAt = nextStatus === 'heard' ? now : null;
  const resolvedAt = nextStatus === 'resolved' ? now : null;
  await env.DB.batch([
    env.DB.prepare(`UPDATE complaints SET status = ? WHERE id = ?`).bind(nextStatus, complaintId),
    env.DB.prepare(
      `UPDATE complaint_state
       SET updated_at = ?,
           heard_at = COALESCE(heard_at, ?),
           resolved_at = COALESCE(resolved_at, ?),
           version = version + 1
       WHERE complaint_id = ?`,
    ).bind(now, heardAt, resolvedAt, complaintId),
    env.DB.prepare(
      `INSERT INTO complaint_events (id, complaint_id, event_type, payload, created_at)
       VALUES (?, ?, 'status_changed', ?, ?)`,
    ).bind(crypto.randomUUID(), complaintId, JSON.stringify({ from: row.status, to: nextStatus, source: 'telegram' }), now),
    env.DB.prepare(
      `UPDATE notification_outbox SET last_synced_status = ? WHERE complaint_id = ?`,
    ).bind(nextStatus, complaintId),
  ]);
  row.status = nextStatus;

  await Promise.all([
    telegram(env, 'answerCallbackQuery', { callback_query_id: callbackId, text: nextStatus === 'resolved' ? 'Als erledigt markiert ✅' : 'Als gehört markiert 👂' }),
    telegram(env, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: notificationText(row),
      reply_markup: inlineKeyboard(row),
      link_preview_options: { is_disabled: true },
    }),
  ]);
  log('telegram_status_updated', { complaintId, status: nextStatus });
}

async function handleWebhook(request, env) {
  const suppliedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!(await secretMatches(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET))) return response('Forbidden', 403);
  await ensureSchema(env);
  const update = await request.json().catch(() => null);
  if (!update) return response('Bad request', 400);
  if (update.callback_query) await handleCallback(update.callback_query, env);
  if (update.message) await handlePairing(update.message, env);
  return response('OK');
}

async function recoverOutbox(env) {
  const { results } = await env.DB.prepare(
    `SELECT n.id
     FROM notification_outbox n
     JOIN complaints c ON c.id = n.complaint_id
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     WHERE s.deleted_at IS NULL
       AND n.attempt_count < ?
       AND (n.status = 'pending' OR (n.status = 'queued' AND (n.queued_at IS NULL OR datetime(n.queued_at) < datetime('now', '-2 hours'))))
     ORDER BY n.created_at ASC LIMIT 50`,
  ).bind(MAX_ATTEMPTS).all();
  for (const row of results) {
    try {
      await env.TELEGRAM_NOTIFICATIONS.send({ notificationId: row.id });
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'queued', queued_at = ?, last_error = NULL WHERE id = ?`,
      ).bind(new Date().toISOString(), row.id).run();
    } catch (error) {
      await env.DB.prepare(
        `UPDATE notification_outbox SET status = 'pending', last_error = ? WHERE id = ?`,
      ).bind(String(error?.message || error).slice(0, 500), row.id).run();
      logError('outbox_requeue_failed', error, { notificationId: row.id });
    }
  }
}

async function syncTelegramStatuses(env) {
  const chatId = await pairedChatId(env);
  if (!chatId) return;
  const { results } = await env.DB.prepare(
    `SELECT n.id, n.complaint_id, n.telegram_message_id, c.title, c.category, c.priority, c.status
     FROM notification_outbox n JOIN complaints c ON c.id = n.complaint_id
     LEFT JOIN complaint_state s ON s.complaint_id = c.id
     WHERE n.status = 'sent' AND n.telegram_message_id IS NOT NULL AND s.deleted_at IS NULL
       AND COALESCE(n.last_synced_status, '') != c.status
     ORDER BY n.sent_at ASC LIMIT 20`,
  ).all();
  for (const row of results) {
    try {
      await telegram(env, 'editMessageText', {
        chat_id: chatId,
        message_id: Number(row.telegram_message_id),
        text: notificationText(row),
        reply_markup: inlineKeyboard(row),
        link_preview_options: { is_disabled: true },
      });
      await env.DB.prepare(`UPDATE notification_outbox SET last_synced_status = ? WHERE id = ?`).bind(row.status, row.id).run();
    } catch (error) {
      logError('telegram_status_sync_failed', error, { notificationId: row.id, complaintId: row.complaint_id });
    }
  }
}

async function retryCleanupJobs(env) {
  const { results } = await env.DB.prepare(
    `SELECT storage_key, kind, attempt_count FROM cleanup_jobs ORDER BY created_at ASC LIMIT 50`,
  ).all();
  for (const job of results) {
    try {
      await env.PHOTOS.delete(job.storage_key);
      await env.DB.prepare(`DELETE FROM cleanup_jobs WHERE storage_key = ?`).bind(job.storage_key).run();
    } catch (error) {
      await env.DB.prepare(
        `UPDATE cleanup_jobs SET attempt_count = attempt_count + 1, last_error = ?, last_attempt_at = ? WHERE storage_key = ?`,
      ).bind(String(error?.message || error).slice(0, 500), new Date().toISOString(), job.storage_key).run();
      logError('cleanup_retry_failed', error, { storageKey: job.storage_key, kind: job.kind });
    }
  }
}

async function purgeExpiredTrash(env) {
  const { results: complaints } = await env.DB.prepare(
    `SELECT c.id FROM complaints c JOIN complaint_state s ON s.complaint_id = c.id
     WHERE s.deleted_at IS NOT NULL AND datetime(s.deleted_at) < datetime('now', '-30 days')
     ORDER BY s.deleted_at ASC LIMIT 10`,
  ).all();
  for (const complaint of complaints) {
    const { results: rows } = await env.DB.prepare(
      `SELECT p.storage_key, d.thumbnail_storage_key
       FROM complaint_photos p LEFT JOIN photo_derivatives d ON d.photo_id = p.id
       WHERE p.complaint_id = ?`,
    ).bind(complaint.id).all();
    const entries = rows.flatMap((row) => [
      row.storage_key ? { key: row.storage_key, kind: 'photo' } : null,
      row.thumbnail_storage_key ? { key: row.thumbnail_storage_key, kind: 'thumbnail' } : null,
    ].filter(Boolean));
    const now = new Date().toISOString();
    await env.DB.batch([
      ...entries.map((entry) => env.DB.prepare(
        `INSERT OR IGNORE INTO cleanup_jobs (storage_key, kind, created_at) VALUES (?, ?, ?)`,
      ).bind(entry.key, entry.kind, now)),
      env.DB.prepare(`DELETE FROM notification_deliveries WHERE complaint_id = ?`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM notification_outbox WHERE complaint_id = ?`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM complaint_events WHERE complaint_id = ?`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM photo_derivatives WHERE photo_id IN (SELECT id FROM complaint_photos WHERE complaint_id = ?)`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM complaint_photos WHERE complaint_id = ?`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM complaint_state WHERE complaint_id = ?`).bind(complaint.id),
      env.DB.prepare(`DELETE FROM complaints WHERE id = ?`).bind(complaint.id),
    ]);
    for (const entry of entries) {
      try {
        await env.PHOTOS.delete(entry.key);
        await env.DB.prepare(`DELETE FROM cleanup_jobs WHERE storage_key = ?`).bind(entry.key).run();
      } catch (error) {
        logError('trash_purge_cleanup_failed', error, { complaintId: complaint.id, storageKey: entry.key });
      }
    }
    log('trash_purged', { complaintId: complaint.id });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/telegram/webhook' || request.method !== 'POST') return response('Not found', 404);
    return handleWebhook(request, env);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const notificationId = typeof message.body?.notificationId === 'string' ? message.body.notificationId : null;
      try {
        await deliver(message.body, env);
        message.ack();
      } catch (error) {
        await ensureSchema(env).catch(() => undefined);
        const finalAttempt = message.attempts >= MAX_ATTEMPTS;
        if (notificationId) {
          await env.DB.prepare(
            `UPDATE notification_outbox
             SET status = ?, last_error = ?, failed_at = CASE WHEN ? THEN ? ELSE failed_at END
             WHERE id = ? AND status NOT IN ('sent', 'cancelled')`,
          ).bind(
            finalAttempt ? 'failed' : 'pending',
            String(error?.message || error).slice(0, 500),
            finalAttempt ? 1 : 0,
            finalAttempt ? new Date().toISOString() : null,
            notificationId,
          ).run().catch(() => undefined);
          await env.DB.prepare(
            `UPDATE notification_deliveries SET last_error = ? WHERE id = ? AND status = 'pending'`,
          ).bind(String(error?.message || error).slice(0, 500), notificationId).run().catch(() => undefined);
        }
        logError('telegram_notification_failed', error, { notificationId, attempts: message.attempts, finalAttempt });
        message.retry({ delaySeconds: 600 });
      }
    }
  },

  async scheduled(controller, env, context) {
    await ensureSchema(env);
    context.waitUntil((async () => {
      const tasks = [
        ['recover_outbox', recoverOutbox(env)],
        ['sync_telegram_statuses', syncTelegramStatuses(env)],
        ['retry_cleanup_jobs', retryCleanupJobs(env)],
      ];
      if (controller.cron === '17 3 * * *') tasks.push(['purge_expired_trash', purgeExpiredTrash(env)]);
      const results = await Promise.allSettled(tasks.map(([, task]) => task));
      results.forEach((result, index) => {
        if (result.status === 'rejected') logError('scheduled_task_failed', result.reason, { task: tasks[index][0] });
      });
    })());
  },
};
