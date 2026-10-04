const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function mailpitMessagesTo(address: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  if (!res.ok) throw new Error(`mailpit search failed: ${res.status}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

export async function waitForMailpit(address: string, count: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const msgs = await mailpitMessagesTo(address);
    if (msgs.length >= count || Date.now() > deadline) return msgs;
    await new Promise((r) => setTimeout(r, 200));
  }
}
