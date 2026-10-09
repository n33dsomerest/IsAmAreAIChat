import 'server-only';

const BASE = 'https://api.slipok.com/api/line/apikey';

/** SlipOK's documented failure codes, mapped to something a user can act on. */
export const SLIPOK_CODES = {
  1000: 'ข้อมูลสลิปไม่ครบ',
  1001: 'ไม่พบข้อมูลสาขา',
  1002: 'Authorization ไม่ถูกต้อง',
  1003: 'แพ็กเกจหมดอายุแล้ว',
  1004: 'โควต้าหมด',
  1005: 'ไฟล์ไม่ใช่รูปภาพ',
  1006: 'รูปภาพไม่ถูกต้อง',
  1007: 'ไม่พบ QR Code ในรูป',
  1008: 'QR นี้ไม่ใช่ QR สำหรับตรวจสอบการชำระเงิน',
  1009: 'ธนาคารขัดข้องชั่วคราว — ลองใหม่ใน 15 นาที',
  1010: 'ธนาคารยังประมวลผลไม่เสร็จ — ลองใหม่อีกครั้ง',
  1011: 'QR หมดอายุหรือไม่มีรายการนี้',
  1012: 'สลิปนี้ถูกใช้ไปแล้ว',
  1013: 'ยอดเงินในสลิปไม่ตรงกับที่ต้องชำระ',
  1014: 'บัญชีผู้รับไม่ตรงกับบัญชีของร้าน',
} as const;

/** Codes worth trying again rather than telling the user it failed. */
const RETRYABLE = new Set([1009]);

/** 1010 is "the bank is still processing" — we retry on a schedule. */
export const BANK_DELAY = 1010;

export type SlipParty = {
  displayName?: string;
  name?: string;
  account?: { type?: string; value?: string };
};

export type SlipData = {
  transRef: string;
  amount: number;
  paidLocalAmount?: number;
  paidLocalCurrency?: string;
  transDate?: string;
  transTime?: string;
  sendingBank?: string;
  receivingBank?: string;
  sender?: SlipParty;
  receiver?: SlipParty;
};

export type SlipResult =
  | { ok: true; data: SlipData }
  | { ok: false; code: number; message: string; retryable: boolean };

function credentials() {
  const branchId = process.env.SLIPOK_BRANCH_ID;
  const apiKey = process.env.SLIPOK_API_KEY;
  if (!branchId || !apiKey) {
    throw new Error('SLIPOK_BRANCH_ID / SLIPOK_API_KEY are not configured');
  }
  return { branchId, apiKey };
}

/**
 * Verifies a slip against the bot's own PromptPay account.
 *
 * `log` is deliberately off: SlipOK's log mode would make every slip single-use
 * at their end, which turns a user who mistypes the amount into a permanent
 * block. Duplicate detection is ours to do — `orders.trans_ref` is unique.
 */
export async function verifySlip(file: File, expectedAmountThb?: number): Promise<SlipResult> {
  const { branchId, apiKey } = credentials();

  const form = new FormData();
  form.append('files', file, file.name || 'slip.jpg');
  form.append('log', 'false');
  if (expectedAmountThb) {
    form.append('amount', String(expectedAmountThb));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(`${BASE}/${branchId}`, {
      method: 'POST',
      headers: { 'x-authorization': apiKey },
      body: form,
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: SlipData;
      code?: number;
      message?: string;
    } | null;

    if (res.ok && body?.success && body.data) {
      return { ok: true, data: body.data };
    }

    const code = Number(body?.code ?? res.status);
    const raw = body?.message ?? `HTTP ${res.status}`;

    return {
      ok: false,
      code,
      // The upstream messages interpolate the bank name and wait time, which
      // is friendlier than our static table — keep theirs when it is prose.
      message: SLIPOK_CODES[code as keyof typeof SLIPOK_CODES] ?? raw,
      retryable: RETRYABLE.has(code),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A timeout or DNS failure says nothing about the slip, so let the user retry.
    return { ok: false, code: -1, message, retryable: true };
  } finally {
    clearTimeout(timer);
  }
}