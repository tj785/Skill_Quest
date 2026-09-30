import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';

/** Wrap an async route so thrown errors reach the error handler. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

const FIELD_NAMES: Record<string, string> = { structure_x: 'Structure x', structure_z: 'Structure z', goal_amount: 'Target', xp_reward: 'XP', coin_reward: 'Coins', block_qty: 'Block quantity',
  reward_xp: 'XP for each helper', reward_coins: 'Coins for each helper', ends_at: 'End date', due_date: 'Due date', x0: 'x0', z0: 'z0', x1: 'x1', z1: 'z1', password: 'Password', username: 'Username' };
/** Our own messages are full sentences; zod's defaults ("Too small: expected number to be >=2") get the field name in front. */
export function zodMessage(err: ZodError) {
  return [...new Set(err.issues.map((i) => {
    if (/[.!?]$/.test(i.message)) return i.message;
    const f = i.path.filter((p) => typeof p === 'string').pop() as string | undefined;
    const name = f ? FIELD_NAMES[f] ?? f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';
    return `${name ? name + ': ' : ''}${i.message.replace(/^Too small: expected (number|string) to (be|have) /, 'must be ').replace(/^Too big: expected (number|string) to (be|have) /, 'must be ')}.`;
  }))].join(' ');
}

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: zodMessage(err) });
  const status = err.status || (err.name === 'EditError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message });
}

export const int = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new HttpError(400, 'Invalid id.');
  return n;
};

/** Minimal RFC-4180 CSV parser (quotes, escaped quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inQ) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map((v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + '\r\n';
}
