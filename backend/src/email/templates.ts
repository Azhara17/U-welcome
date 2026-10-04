import type { EmailKind } from '../jobs/queue.js';
import type { Event, Registration } from '../schema.js';

export interface TemplateContext {
  event: Event;
  registration: Registration;
  appUrl: string;
  timeZone: string;
}

export function formatEventDate(date: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'long', timeStyle: 'short', timeZone,
  }).format(date);
  return `${formatted} (${timeZone})`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderEmail(kind: EmailKind, ctx: TemplateContext) {
  const { event, registration } = ctx;
  const when = formatEventDate(event.startsAt, ctx.timeZone);
  const ticketUrl = `${ctx.appUrl}/tickets/${registration.manageToken}`;
  const code = registration.ticketCode;

  const variants: Record<EmailKind, { subject: string; lines: string[] }> = {
    registered: {
      subject: `Ваш билет: ${event.title}`,
      lines: [`Вы зарегистрированы на «${event.title}».`, `Когда: ${when}.`, `Код билета: ${code}.`],
    },
    waitlisted: {
      subject: `Лист ожидания: ${event.title}`,
      lines: [
        `Мест на «${event.title}» пока нет, вы в листе ожидания.`,
        'Если место освободится, оно автоматически перейдёт к вам, и мы пришлём билет.',
        `Когда: ${when}.`,
      ],
    },
    promoted: {
      subject: `Место освободилось: ${event.title}`,
      lines: [`Для вас освободилось место на «${event.title}».`, `Когда: ${when}.`, `Код билета: ${code}.`],
    },
    reminder: {
      subject: `Напоминание: завтра ${event.title}`,
      lines: [`Напоминаем: «${event.title}» уже скоро.`, `Когда: ${when}.`, `Код билета: ${code}.`],
    },
    rescheduled: {
      subject: `Событие перенесено: ${event.title}`,
      lines: [
        `Событие «${event.title}» перенесено.`,
        `Новая дата: ${when}.`,
        registration.status === 'confirmed'
          ? `Ваш билет остаётся в силе, код: ${code}.`
          : 'Вы по-прежнему в листе ожидания.',
      ],
    },
  };

  const { subject, lines } = variants[kind];
  const footer = 'Билет и отказ от участия:';
  const text = [...lines, '', `${footer} ${ticketUrl}`].join('\n');
  const html = [
    ...lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    `<p>${escapeHtml(footer)} <a href="${escapeHtml(ticketUrl)}">${escapeHtml(ticketUrl)}</a></p>`,
  ].join('\n');
  return { subject, text, html };
}
