const encoder = new TextEncoder();
const PORTAL_URL = 'https://booboo-portal.pages.dev/#admin';

function response(message, status = 200) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function secretMatches(received, expected) {
  if (!received || !expected) return false;
  const [receivedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(received)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(receivedHash, expectedHash);
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
  return ({ low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' })[priority] || '';
}

function notificationText(message) {
  const lines = [
    '💌 Neue Booboo-Beschwerde',
    '',
    `Kategorie: ${message.category || 'Andere Angelegenheit'}`,
    `Titel: ${message.title || 'Ohne Titel'}`,
  ];
  const priority = priorityLabel(message.priority);
  if (priority) lines.push(`Priorität: ${priority}`);
  lines.push('', 'Im privaten Dashboard anschauen:');
  return lines.join('\n');
}

async function handleWebhook(request, env) {
  const suppliedSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!(await secretMatches(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET))) return response('Forbidden', 403);
  const update = await request.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id;
  const isPrivateChat = message?.chat?.type === 'private';
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  const expectedStart = `/start ${env.TELEGRAM_PAIRING_CODE || ''}`;

  if (!chatId || !isPrivateChat || !env.TELEGRAM_PAIRING_CODE || text !== expectedStart) return response('OK');

  const current = await env.DB.prepare(
    'SELECT setting_value FROM notification_settings WHERE setting_key = ?'
  ).bind('telegram_chat_id').first();

  if (!current) {
    const now = new Date().toISOString();
    await env.DB.prepare(
      'INSERT INTO notification_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?)'
    ).bind('telegram_chat_id', String(chatId), now).run();
    await telegram(env, 'sendMessage', {
      chat_id: chatId,
      text: '💗 Verbunden! Neue Beschwerden landen ab jetzt hier.',
    });
  }

  return response('OK');
}

async function deliver(message, env) {
  const notificationId = typeof message?.notificationId === 'string' ? message.notificationId : '';
  if (!notificationId) throw new Error('Notification id is missing.');
  const delivery = await env.DB.prepare(
    'SELECT status FROM notification_deliveries WHERE id = ?'
  ).bind(notificationId).first();
  if (!delivery || delivery.status === 'sent') return;

  const chat = await env.DB.prepare(
    'SELECT setting_value FROM notification_settings WHERE setting_key = ?'
  ).bind('telegram_chat_id').first();
  if (!chat?.setting_value) throw new Error('Telegram recipient has not been paired yet.');

  const sent = await telegram(env, 'sendMessage', {
    chat_id: chat.setting_value,
    text: notificationText(message),
    reply_markup: { inline_keyboard: [[{ text: 'Dashboard öffnen 💗', url: PORTAL_URL }]] },
    link_preview_options: { is_disabled: true },
  });
  await env.DB.prepare(
    'UPDATE notification_deliveries SET status = ?, telegram_message_id = ?, sent_at = ?, last_error = NULL WHERE id = ?'
  ).bind('sent', String(sent.message_id || ''), new Date().toISOString(), notificationId).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/telegram/webhook' || request.method !== 'POST') return response('Not found', 404);
    return handleWebhook(request, env);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await deliver(message.body, env);
        message.ack();
      } catch (error) {
        const notificationId = typeof message.body?.notificationId === 'string' ? message.body.notificationId : null;
        if (notificationId) {
          await env.DB.prepare(
            'UPDATE notification_deliveries SET last_error = ? WHERE id = ? AND status = ?'
          ).bind(String(error?.message || 'Telegram delivery failed.').slice(0, 500), notificationId, 'pending').run();
        }
        console.error(JSON.stringify({ event: 'telegram_notification_failed', notificationId, error: String(error?.message || error) }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
};
