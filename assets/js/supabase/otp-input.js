/**
 * OTP入力UIの純粋ロジック（6桁、数字のみ、auto advance、paste対応、再送クールダウン）。
 * DOM操作はtimebox.js側で行い、ここでは文字列/配列の変換だけを行う（§16）。
 */

export const OTP_LENGTH = 6;
export const RESEND_COOLDOWN_MS = 30_000;

/** 数字以外を除去し、最大6桁に丸める */
export function sanitizeDigits(raw) {
  return String(raw ?? "")
    .replace(/\D/g, "")
    .slice(0, OTP_LENGTH);
}

/** 6桁ペーストを1マスずつの配列へ展開する（例: "123456" → ["1",...,"6"]） */
export function digitsToArray(digits) {
  const sanitized = sanitizeDigits(digits);
  const arr = new Array(OTP_LENGTH).fill("");
  for (let i = 0; i < sanitized.length; i += 1) arr[i] = sanitized[i];
  return arr;
}

export function arrayToDigits(arr) {
  return sanitizeDigits((arr ?? []).join(""));
}

export function isComplete(digitsArray) {
  return arrayToDigits(digitsArray).length === OTP_LENGTH;
}

/**
 * 1マス入力後、次にフォーカスすべきインデックスを返す（auto advance）。
 * 最後のマスまで埋まっていれば null（次は無い＝Verifyへ）。
 */
export function nextFocusIndex(index, value) {
  if (value && index < OTP_LENGTH - 1) return index + 1;
  return null;
}

export function canResend(lastSentAt, now = Date.now(), cooldownMs = RESEND_COOLDOWN_MS) {
  if (!lastSentAt) return true;
  return now - new Date(lastSentAt).getTime() >= cooldownMs;
}

export function resendCooldownRemainingSeconds(lastSentAt, now = Date.now(), cooldownMs = RESEND_COOLDOWN_MS) {
  if (!lastSentAt) return 0;
  const remaining = cooldownMs - (now - new Date(lastSentAt).getTime());
  return Math.max(0, Math.ceil(remaining / 1000));
}
