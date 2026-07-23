import worker from './index.js';

async function reconcileLegacyNotifications(env) {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO notification_outbox
       (id, complaint_id, status, telegram_message_id, last_error, created_at, sent_at)
       SELECT legacy.id, legacy.complaint_id,
              CASE WHEN legacy.status = 'sent' THEN 'sent' ELSE 'pending' END,
              legacy.telegram_message_id, legacy.last_error, legacy.created_at, legacy.sent_at
       FROM notification_deliveries legacy
       JOIN complaints c ON c.id = legacy.complaint_id`,
    ).run();
    await env.DB.prepare(
      `UPDATE notification_outbox
       SET status = 'sent',
           telegram_message_id = COALESCE(telegram_message_id, (SELECT telegram_message_id FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id)),
           sent_at = COALESCE(sent_at, (SELECT sent_at FROM notification_deliveries legacy WHERE legacy.id = notification_outbox.id)),
           last_error = NULL,
           failed_at = NULL
       WHERE status != 'sent'
         AND id IN (SELECT id FROM notification_deliveries WHERE status = 'sent')`,
    ).run();
  } catch {
    // The wrapped worker creates the schema when it does not exist yet.
  }
}

export default {
  async fetch(request, env, context) {
    await reconcileLegacyNotifications(env);
    return worker.fetch(request, env, context);
  },

  async queue(batch, env, context) {
    await reconcileLegacyNotifications(env);
    return worker.queue(batch, env, context);
  },

  async scheduled(controller, env, context) {
    await reconcileLegacyNotifications(env);
    return worker.scheduled(controller, env, context);
  },
};
