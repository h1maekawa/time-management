/**
 * App Badge API（§82）。未対応ブラウザでは何もしない（例外を投げない）。
 * 表示件数は「今日の未完了Task数」。将来「進行中/要対応」ベースへ変えられるよう、
 * 呼び出し側からcountを渡すだけの薄いラッパーにしておく。
 */

export function isAppBadgeSupported() {
  return typeof navigator !== "undefined" && typeof navigator.setAppBadge === "function";
}

export function setAppBadgeCount(count) {
  if (!isAppBadgeSupported()) return;
  try {
    if (count > 0) navigator.setAppBadge(count);
    else navigator.clearAppBadge();
  } catch {
    // Badging APIが一時的に使えない場合も無視する（表示上の付加機能のため）
  }
}
