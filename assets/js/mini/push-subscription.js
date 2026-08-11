/**
 * Web Push 購読の補助関数（§75-77/§90）。
 *
 * 実際のブラウザAPI呼び出し（Notification許可要求・Service Worker登録・
 * PushManager.subscribe）はtimebox.js側で行う。ここでは
 *  - VAPID公開鍵の変換（Push APIが要求するUint8Array形式）
 *  - PushSubscriptionオブジェクト → DB行への変換
 * という、ネットワークに触れない純粋な変換だけを持つ。
 */

export function isPushSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window;
}

/** VAPID公開鍵。未設定ならPush購読UIは「未設定です」として振る舞う（Supabase未設定時と同じ方針）。 */
export function getVapidPublicKey() {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  const value = env?.VITE_PUSH_VAPID_PUBLIC_KEY;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function isPushConfigured() {
  return Boolean(getVapidPublicKey());
}

/** VAPID公開鍵（base64url文字列）をPushManager.subscribeが要求するUint8Arrayへ変換する */
export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/**
 * ブラウザの `PushSubscription.toJSON()` が返す形を、push_subscriptions行の形へ変換する。
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscriptionJson
 */
export function subscriptionToRow({ subscriptionJson, userId, deviceId }) {
  return {
    user_id: userId,
    device_id: deviceId,
    endpoint: subscriptionJson.endpoint,
    p256dh: subscriptionJson.keys?.p256dh ?? "",
    auth_key: subscriptionJson.keys?.auth ?? "",
    enabled: true,
  };
}

/** この端末が既に同じendpointで購読済みかどうか（重複購読を作らない。§90 no-duplicate-subscription） */
export function isSameSubscription(existingRow, subscriptionJson) {
  return Boolean(existingRow) && existingRow.endpoint === subscriptionJson.endpoint;
}
