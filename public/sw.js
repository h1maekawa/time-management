/**
 * DAYLOOP Service Worker — PWA installability + Web Push受信（§72/§75/§86）。
 *
 * オフラインキャッシュ戦略は持たない（Phase 1のスコープ外。壊れたキャッシュで
 * DAYLOOPが起動できなくなるほうが害が大きいため、意図的に持たせていない）。
 * 役目は2つだけ：
 *  1. PWAとしてinstallableにするための最小要件を満たす
 *  2. Push通知を受け取って表示し、クリックでDAYLOOPを開く
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "DAYLOOP", body: "DAYLOOPの予定があります。" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // JSON以外のpayloadは無視して既定文言を使う
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/images/dayloop/brand/dayloop-logo-icon.svg",
      badge: "/images/dayloop/brand/dayloop-logo-icon.svg",
      tag: payload.tag || "daylock-execution",
      renotify: false,
      data: { url: payload.url || "/app/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/app/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of allClients) {
        if (client.url.includes("/app/") && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
