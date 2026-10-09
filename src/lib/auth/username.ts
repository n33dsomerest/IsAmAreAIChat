/**
 * Usernames, not emails, are what people log in with. Supabase Auth only
 * understands emails, so a username/password account gets a *synthetic* email
 * (`bob@users.aichat.app`) that can never receive mail and is never shown.
 * Sign-in reverses the mapping.
 *
 * Google accounts are the exception: they carry a real email, which we keep as
 * the identity and derive a display username from.
 */

const DEFAULT_DOMAIN = 'users.aichat.app';

export const syntheticEmailDomain =
  process.env.SYNTHETIC_EMAIL_DOMAIN?.trim() || DEFAULT_DOMAIN;

const RESERVED = new Set([
  'admin', 'administrator', 'root', 'api', 'app', 'adminpanel',
  'login', 'logout', 'register', 'signup', 'signin', 'pricing', 'billing',
  'settings', 'support', 'help', 'about', 'contact', 'legal', 'privacy',
  'terms', 'www', 'mail', 'email', 'null', 'undefined', 'system', 'user',
  'test', 'demo', 'guest', 'moderator', 'staff', 'owner', 'me', 'you',
]);

export const USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;

export type UsernameCheck = { ok: true } | { ok: false; error: string };

export function validateUsername(raw: string): UsernameCheck {
  const username = raw.trim().toLowerCase();

  if (!username) return { ok: false, error: 'กรุณากรอกชื่อผู้ใช้' };
  if (username.length < 3) return { ok: false, error: 'ชื่อผู้ใช้ต้องยาวอย่างน้อย 3 ตัวอักษร' };
  if (username.length > 32) return { ok: false, error: 'ชื่อผู้ใช้ยาวได้ไม่เกิน 32 ตัวอักษร' };
  if (raw !== raw.trim()) return { ok: false, error: 'ชื่อผู้ใช้ห้ามมีช่องว่างนำหรือท้าย' };
  if (!/^[a-z0-9_]+$/.test(username))
    return { ok: false, error: 'ใช้ได้เฉพาะตัวอักษรอังกฤษตัวเล็ก ตัวเลข และ _' };
  if (!/^[a-z]/.test(username)) return { ok: false, error: 'ต้องขึ้นต้นด้วยตัวอักษร' };
  if (RESERVED.has(username)) return { ok: false, error: 'ชื่อผู้ใช้นี้ถูกสงวนไว้ กรุณาเลือกชื่ออื่น' };

  return { ok: true };
}

export const normalizeUsername = (raw: string) => raw.trim().toLowerCase();

/**
 * Usernames allow `_`, but Supabase's email validation is stricter than RFC 5322
 * and may reject it in the local part. Mapping `_` → `-` keeps the transform
 * injective (usernames can never contain `-`, so no two usernames collide) and
 * stays reversible in the direction we need: login only ever maps
 * username → email, never back.
 */
const toEmailLocalPart = (username: string) =>
  normalizeUsername(username).replace(/_/g, '-');

export const toSyntheticEmail = (username: string) =>
  `${toEmailLocalPart(username)}@${syntheticEmailDomain}`;

/** True when this email is one we minted, rather than a real one (Google). */
export const isSyntheticEmail = (email: string) =>
  email.toLowerCase().endsWith(`@${syntheticEmailDomain.toLowerCase()}`);

export const usernameFromEmail = (email: string) =>
  email.split('@')[0]?.toLowerCase() ?? '';