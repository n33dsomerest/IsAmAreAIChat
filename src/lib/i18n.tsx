'use client';

import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';

export type Locale = 'th' | 'en';

const STORAGE_KEY = 'aichat.locale';

const MESSAGES: Record<Locale, Record<string, string>> = {
  th: {
    'nav.newChat': 'แชทใหม่',
    'nav.recent': 'สนทนาล่าสุด',
    'nav.topUp': 'เติมเครดิต',
    'nav.artifacts': 'ชิ้นงาน',
    'nav.billing': 'ประวัติการซื้อ',
    'nav.settings': 'ตั้งค่า',
    'nav.admin': 'ผู้ดูแลระบบ',
    'nav.signIn': 'เข้าสู่ระบบ',
    'nav.signUp': 'สมัครสมาชิก',
    'nav.signOut': 'ออกจากระบบ',
    'chat.placeholder': 'พิมพ์ข้อความ… (Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่)',
    'chat.send': 'ส่งข้อความ',
    'chat.stop': 'หยุดการตอบ',
    'chat.credits': 'เครดิตคงเหลือ',
    'chat.signInHint': 'เข้าสู่ระบบเพื่อเริ่มแชท',
    'chat.emptyTitle': 'เริ่มแชท',
    'chat.search': 'ค้นหาบนเว็บ',
    'chat.attach': 'แนบไฟล์',
    'chat.costNote': '1 ข้อความ = 1 เครดิต · การเรียกเครื่องมือไม่นับเครดิต',
    'auth.email': 'อีเมล',
    'auth.username': 'ชื่อผู้ใช้',
    'auth.password': 'รหัสผ่าน',
    'auth.signIn': 'เข้าสู่ระบบ',
    'auth.signUp': 'สมัครสมาชิก',
    'auth.or': 'หรือ',
    'auth.google': 'เข้าสู่ระบบด้วย Google',
    'auth.noAccount': 'ยังไม่มีบัญชี?',
    'auth.hasAccount': 'มีบัญชีแล้ว?',
    'pricing.title': 'เลือกแพ็กเกจ',
    'pricing.subtitle': 'เครดิตไม่มีวันหมดอายุ · ใช้ได้กับทุกโมเดลในระบบ',
    'pricing.buy': 'ซื้อและอัปโหลดสลิป',
    'pricing.upload': 'อัปโหลดสลิป',
    'pricing.scan': 'สแกนเพื่อโอน',
  },
  en: {
    'nav.newChat': 'New chat',
    'nav.recent': 'Recent',
    'nav.topUp': 'Top up',
    'nav.artifacts': 'Artifacts',
    'nav.billing': 'Purchase history',
    'nav.settings': 'Settings',
    'nav.admin': 'Admin',
    'nav.signIn': 'Sign in',
    'nav.signUp': 'Sign up',
    'nav.signOut': 'Sign out',
    'chat.placeholder': 'Type a message… (Enter to send, Shift+Enter for a new line)',
    'chat.send': 'Send',
    'chat.stop': 'Stop',
    'chat.credits': 'Credits',
    'chat.signInHint': 'Sign in to start chatting',
    'chat.emptyTitle': 'Start a conversation',
    'chat.search': 'Web search',
    'chat.attach': 'Attach a file',
    'chat.costNote': '1 message = 1 credit · tool calls are free',
    'auth.email': 'Email',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.signIn': 'Sign in',
    'auth.signUp': 'Create account',
    'auth.or': 'or',
    'auth.google': 'Continue with Google',
    'auth.noAccount': 'No account yet?',
    'auth.hasAccount': 'Already have an account?',
    'pricing.title': 'Pick a package',
    'pricing.subtitle': 'Credits never expire · work with every model',
    'pricing.buy': 'Buy and upload your slip',
    'pricing.upload': 'Upload slip',
    'pricing.scan': 'Scan to pay',
  },
};

type I18n = {
  locale: Locale;
  t: (key: string) => string;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18n>({
  locale: 'th',
  t: (key) => key,
  setLocale: () => {},
});

/**
 * localStorage is the single source of truth for the locale, so it is read
 * through `useSyncExternalStore` rather than mirrored into state. That store is
 * built for exactly this case: the server has no localStorage, and
 * `getServerSnapshot` is what React renders *and* hydrates against, so the
 * markup matches and the stored preference swaps in immediately afterwards.
 * Doing it with `useState` + an effect instead either costs a second render or,
 * if the state is seeded during render, produces a hydration mismatch.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // The `storage` event only fires in other tabs, so it is a bonus for keeping
  // two open tabs in step — not the in-tab notification path.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readStoredLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'th' || saved === 'en') return saved;
  return navigator.language.slice(0, 2).toLowerCase() === 'th' ? 'th' : 'en';
}

function writeStoredLocale(next: Locale) {
  localStorage.setItem(STORAGE_KEY, next);
  for (const onChange of listeners) onChange();
}

/** The server has no localStorage, so it always renders Thai. */
const serverLocale: Locale = 'th';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readStoredLocale, () => serverLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value: I18n = {
    locale,
    t: (key) => MESSAGES[locale][key] ?? MESSAGES.th[key] ?? key,
    setLocale: writeStoredLocale,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}

/** Shorthand for components that only need the string. */
export function useT(): (key: string) => string {
  return useI18n().t;
}