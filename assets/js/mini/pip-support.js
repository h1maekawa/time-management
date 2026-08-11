/**
 * Document Picture-in-Picture サポート（§66/§70）。
 *
 * DAYLOOP MiniはPiP window専用の別スクリプト/別状態を持たない。
 * Document PiPは「同じDOM要素を、別のtop-level browsing contextへ実体移動する」API
 * であるため、Main側で使っている状態・イベントハンドラ付きの要素をそのまま
 * `pipWindow.document.body.append(el)` すれば、Main/Miniの二重状態管理を避けられる（§69/§83）。
 *
 * 自動起動しない。必ずユーザー操作（クリック）から呼び出すこと。
 */

export function isPipSupported() {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

/** 現在開いているPiP windowを返す（無ければnull）。閉じたかどうかの判定にも使える。 */
export function currentPipWindow() {
  if (!isPipSupported()) return null;
  return window.documentPictureInPicture.window ?? null;
}

/**
 * Main documentの<style>/<link rel=stylesheet>をPiP windowへコピーする。
 * PiP windowは空のdocumentから始まるため、既存CSSクラス（tb-*）をそのまま使うために必要。
 */
export function copyStylesToPipWindow(pipWindow) {
  for (const styleSheet of Array.from(document.styleSheets)) {
    try {
      const cssRules = Array.from(styleSheet.cssRules)
        .map((rule) => rule.cssText)
        .join("");
      const style = pipWindow.document.createElement("style");
      style.textContent = cssRules;
      pipWindow.document.head.appendChild(style);
    } catch {
      // cross-origin stylesheet等でcssRulesが読めない場合は<link>としてコピーする
      if (styleSheet.href) {
        const link = pipWindow.document.createElement("link");
        link.rel = "stylesheet";
        link.type = styleSheet.type || "text/css";
        if (styleSheet.media) link.media = String(styleSheet.media);
        link.href = styleSheet.href;
        pipWindow.document.head.appendChild(link);
      }
    }
  }
}

/**
 * PiP windowを開く。非対応環境ではnullを返す（例外を投げない。呼び出し側はFallback UIへ）。
 * ユーザー操作のクリックハンドラの中から呼ぶこと（ブラウザの要求）。
 */
export async function openPipWindow({ width = 320, height = 360 } = {}) {
  if (!isPipSupported()) return null;
  const pipWindow = await window.documentPictureInPicture.requestWindow({ width, height });
  copyStylesToPipWindow(pipWindow);
  pipWindow.document.title = "DAYLOOP";
  pipWindow.document.body.style.margin = "0";
  return pipWindow;
}
