export interface SseMessage { event: string; data: any }

/** Минимальный SSE-клиент для тестов: копит сообщения, умеет ждать следующее подходящее. */
export async function openSse(url: string) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
  if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

  const messages: SseMessage[] = [];
  let cursor = 0; // индекс первого неразобранного сообщения
  const waiters: (() => void)[] = [];
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';

  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (event && data) {
            messages.push({ event, data: JSON.parse(data) });
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch { /* abort */ }
  })();

  return {
    messages,
    headers: res.headers,
    /**
     * Ждёт первое ещё не разобранное сообщение, подходящее под условие, — в том числе
     * пришедшее ДО вызова (иначе гонка: снимок может прийти, пока тест ждёт другой поток).
     * Сообщения до найденного считаются разобранными.
     */
    async next(pred: (m: SseMessage) => boolean = () => true, timeoutMs = 5000): Promise<SseMessage> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const idx = messages.findIndex((m, i) => i >= cursor && pred(m));
        if (idx >= 0) { cursor = idx + 1; return messages[idx]!; }
        if (Date.now() > deadline) throw new Error(`SSE: no matching message in ${timeoutMs}ms`);
        await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 100); });
      }
    },
    /** Первое сообщение (снимок при подключении). */
    async first(timeoutMs = 5000) {
      cursor = 0;
      return this.next(() => true, timeoutMs);
    },
    close: () => ctrl.abort(),
  };
}
