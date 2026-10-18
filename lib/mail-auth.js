import { service } from './server';

export const SYSTEM_ADMIN = 'mds2026@mds-healthcare.com';
export function isSuperAdmin(actor) {
  return Boolean(actor && actor.role === 'admin' && actor.email?.toLowerCase() === SYSTEM_ADMIN);
}
export function ownsMailbox(actor, mailboxId) {
  return Boolean(actor && (actor.id === mailboxId || isSuperAdmin(actor)));
}
export async function getMailbox(actor, id) {
  if (!actor) throw new Error('AUTH_REQUIRED');
  const mailboxId = id || actor.id;
  if (!ownsMailbox(actor, mailboxId)) throw new Error('NO_ACCESS');
  const { data, error } = await service().from('mailboxes').select('*').eq('id', mailboxId).maybeSingle();
  if (error) throw error;
  if (!data || data.status !== 'active') throw new Error('ACCOUNT_UNAVAILABLE');
  return data;
}
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); }
  catch { return false; }
}
export function parseAddresses(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : String(input).split(',');
  return [...new Set(list.map(x => String(x).trim()).filter(Boolean))];
}
export function addressesValid(addresses) {
  return addresses.every(value =>
    value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)
  );
}
export const MAX_ATTACHMENT = 10 * 1024 * 1024;
export const MAX_COMBINED = 20 * 1024 * 1024;
export function cleanFilename(name) {
  return String(name || 'attachment').normalize('NFKC').replace(/[^\p{L}\p{N} ._()-]/gu, '_').slice(0, 120).trim() || 'attachment';
}
export function verifiedAttachmentRefs(list, mailboxId) {
  if (!Array.isArray(list)) return [];
  if (list.length > 5) throw Error('TOO_MANY_FILES');
  let total = 0;
  return list.map(x => {
    const path = String(x.path || '');
    const prefix = 'mailboxes/' + mailboxId + '/';
    if (!path.startsWith(prefix) || !/^mailboxes\/[0-9a-f-]{36}\/pending\/[0-9a-f-]{36}\/[^/]{1,120}$/i.test(path))
      throw Error('FILE_INVALID');
    const filename = cleanFilename(x.filename);
    const contentType = String(x.contentType || 'application/octet-stream').slice(0, 120);
    const size = Number(x.size || 0);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ATTACHMENT) throw Error('FILE_TOO_LARGE');
    total += size;
    return { path, filename, contentType, size };
  }).map(item => {
    if (total > MAX_COMBINED) throw Error('FILE_TOO_LARGE');
    return item;
  });
}
export function webError(e, status = 400) {
  const err = String(e?.message || e);
  const map = {
    AUTH_REQUIRED: [401, 'Your session has expired. Please sign in again.'],
    NO_ACCESS: [403, 'You can only access your own mailbox.'],
    ACCOUNT_UNAVAILABLE: [403, 'This mailbox is not available.'],
    INVALID_ORIGIN: [403, 'Please refresh the page and try again.'],
    INVALID_TO: [400, 'Please enter a valid recipient email address.'],
    INVALID_CC: [400, 'Please correct the CC address or leave it blank.'],
    INVALID_BCC: [400, 'Please correct the BCC address or leave it blank.'],
    NO_RECIPIENT: [400, 'Add at least one recipient.'],
    TOO_MANY_RECIPIENTS: [400, 'Please send to fewer recipients at a time.'],
    NO_CONTENT: [400, 'Write a message before sending.'],
    FILE_INVALID: [400, 'This attachment could not be verified. Remove it and upload it again.'],
    FILE_TOO_LARGE: [413, 'Attachment size exceeded the limit (10 MB each, 20 MB total).'],
    TOO_MANY_FILES: [400, 'You can attach up to five files per message.'],
    DELIVERY_FAILED: [502, 'Your message could not be delivered. Please try again in a moment.'],
    FILE_UPLOAD_FAILED: [502, 'The file could not be uploaded. Please try again.'],
    MAIL_NOT_FOUND: [404, 'This message is no longer available.'],
  };
  const info = map[err];
  if (!info) console.error('MDS Mail server error:', e);
  return Response.json({error: info?.[1] || (status === 503 ? 'Email service is temporarily unavailable.' : 'Something went wrong. Please try again.'), code: info ? err : 'REQUEST_FAILED'}, {status: info?.[0] || status, headers:{'Cache-Control':'no-store'}});
}
