import { pathToFileURL } from 'node:url';
import { evaluate, type Alert, type SnapshotAnswer } from './evaluate.ts';

/**
 * ONE CHECK. Reads the snapshot with the public anon key and one token, decides
 * whom to tell, and tells them on Telegram. It runs on a schedule outside the
 * project it watches (.github/workflows/admin-alert.yml), so it goes on when the
 * project does not. It holds no service-role key.
 *
 * A failed send throws, so the scheduled job turns red and somebody sees it.
 */
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALERT_TOKEN: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_OPS: string;
  TELEGRAM_CHAT_SAFETY: string;
}

export async function fetchSnapshot(env: Env, fetchImpl: typeof fetch = fetch): Promise<SnapshotAnswer | null> {
  try {
    const res = await fetchImpl(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/alert_snapshot`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ p_token: env.ALERT_TOKEN }),
    });
    if (!res.ok) return null;
    return (await res.json()) as SnapshotAnswer;
  } catch {
    return null;
  }
}

export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  // The token is in the address, so the address is never in the message.
  if (!res.ok) throw new Error(`telegram refused the message (${res.status})`);
}

export async function runOnce(
  env: Env,
  nowMinutes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: Alert[] }> {
  const alerts = evaluate(await fetchSnapshot(env, fetchImpl), nowMinutes);
  for (const a of alerts) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, a.channel === 'safety' ? env.TELEGRAM_CHAT_SAFETY : env.TELEGRAM_CHAT_OPS, a.text, fetchImpl);
  }
  return { sent: alerts };
}

function envFromProcess(): Env {
  const get = (k: keyof Env): string => {
    const v = process.env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  return {
    SUPABASE_URL: get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: get('SUPABASE_ANON_KEY'),
    ALERT_TOKEN: get('ALERT_TOKEN'),
    TELEGRAM_BOT_TOKEN: get('TELEGRAM_BOT_TOKEN'),
    TELEGRAM_CHAT_OPS: get('TELEGRAM_CHAT_OPS'),
    TELEGRAM_CHAT_SAFETY: get('TELEGRAM_CHAT_SAFETY'),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { sent } = await runOnce(envFromProcess(), Math.floor(Date.now() / 60_000));
  console.log(sent.length ? `sent ${sent.length}: ${sent.map((a) => a.key).join(', ')}` : 'nothing to send');
}
