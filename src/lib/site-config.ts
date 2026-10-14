/**
 * Commercial configuration.
 *
 * The database (`credit_packages` + `app_settings`) is the source of truth and
 * is seeded from the same numbers. These constants are the offline fallback
 * used by the marketing/pricing UI before the database is wired up, and keep
 * the two in sync by convention — update both together.
 */

export const CREDIT_PACKAGES = [
  {
    code: 'starter',
    name: 'Starter',
    priceThb: 29,
    credits: 35,
    qrPath: '/qr/29Baht.png',
  },
  {
    code: 'standard',
    name: 'Standard',
    priceThb: 59,
    credits: 85,
    qrPath: '/qr/59Baht.png',
  },
  {
    code: 'pro',
    name: 'Pro',
    priceThb: 99,
    credits: 145,
    qrPath: '/qr/99Baht.png',
  },
] as const;

export type CreditPackageCode = (typeof CREDIT_PACKAGES)[number]['code'];

export const packageByCode = (code: string) =>
  CREDIT_PACKAGES.find((p) => p.code === code);

/** Baht per request, rounded to 3 decimals. */
export const pricePerRequest = (priceThb: number, credits: number) =>
  Math.round((priceThb / credits) * 1000) / 1000;

export const formatBaht = (amount: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

export const FREE_TIER = {
  /** Credits granted once, at signup — the same number the first daily refill tops up to. */
  welcomeCredits: 20,
  /** Days at the higher trial quota. */
  trialDays: 3,
  /** Requests/day during the trial. */
  dailyQuota: 10,
  /** Requests/day once the trial is over — lifted permanently on first purchase. */
  dailyQuotaAfterTrial: 5,
  /**
   * Credit balance every account is topped up to once a day.
   *
   * A different clock from the quotas above: the request cap counts messages,
   * this counts the balance, and the two are allowed to disagree.
   */
  dailyRefillCredits: 20,
  /** Days from signup during which the higher refill applies. */
  dailyRefillDays: 7,
  /** Balance to fall back to once the refill window has passed. */
  dailyRefillCreditsAfter: 10,
} as const;

export const SITE = {
  name: 'AIChat',
  taglineTh: 'แชท AI หลายโมเดลในที่เดียว',
  taglineEn: 'One chat, every frontier model.',
} as const;