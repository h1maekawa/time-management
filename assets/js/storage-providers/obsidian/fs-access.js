/**
 * File System Access API のラッパー。
 * ここはブラウザAPI（window.showDirectoryPicker / FileSystemDirectoryHandle）に
 * 直接依存するため、Node環境ではテストできない
 * （純粋ロジックは同じ階層の markdown.js 側に分離してある）。
 *
 * HTTPS環境 + Chromium系ブラウザ前提。未対応ブラウザでは
 * isFileSystemAccessSupported() が false になるので、呼び出し側は
 * obsidian-uri.js による fallback へ切り替えること。
 */

export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/** Vault（またはTimebox保存先）フォルダをブラウザのダイアログで選ばせる */
export async function pickVaultDirectory() {
  if (!isFileSystemAccessSupported()) {
    throw new Error("このブラウザはフォルダ選択（File System Access API）に対応していません。");
  }
  return window.showDirectoryPicker({ id: "timebox-os-vault", mode: "readwrite" });
}

/** 既存のハンドルに対して読み書き権限があるか確認し、無ければ再要求する */
export async function ensurePermission(handle) {
  if (!handle) return false;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/** "Timebox/Captures" のようなpathを、必要なら作りながら辿ってディレクトリハンドルを返す */
export async function getOrCreateSubdirectory(rootHandle, path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  let dir = rootHandle;
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

/** 作らずに存在確認だけ行う（Folder existence check） */
export async function directoryExists(rootHandle, path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  let dir = rootHandle;
  try {
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: false });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全にファイルへ書き込む。
 * mode: "overwrite"（既定・毎回上書き） | "append"（既存の末尾へ追記） |
 *       "create-only"（既にファイルがあれば何もしない＝上書き事故を避ける）
 */
export async function writeFile(dirHandle, filename, content, { mode = "overwrite" } = {}) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });

  if (mode === "create-only") {
    const existing = await fileHandle.getFile();
    if (existing.size > 0) return { written: false, reason: "already-exists" };
  }

  let finalContent = content;
  if (mode === "append") {
    const existing = await fileHandle.getFile();
    const existingText = existing.size > 0 ? await existing.text() : "";
    finalContent = existingText ? `${existingText}\n${content}` : content;
  }

  const writable = await fileHandle.createWritable();
  await writable.write(finalContent);
  await writable.close();
  return { written: true };
}

export async function readFile(dirHandle, filename) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}
