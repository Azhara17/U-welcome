import { randomBytes, randomInt } from 'node:crypto';

// Без 0/O, 1/I/L: код вводят руками на входе.
const TICKET_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TICKET_LENGTH = 8;

export function generateTicketCode(): string {
  let code = '';
  for (let i = 0; i < TICKET_LENGTH; i++) code += TICKET_ALPHABET[randomInt(TICKET_ALPHABET.length)];
  return code;
}

export function generateManageToken(): string {
  return randomBytes(24).toString('base64url');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
