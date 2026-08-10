/**
 * Obsidian URI Scheme による fallback。
 * File System Access API が使えないブラウザ（第一優先の直接保存が使えない場合）向けの
 * note作成/オープン支援。ユーザーがクリックしてObsidianアプリ側に処理を渡す。
 * https://help.obsidian.md/Extending+Obsidian/Obsidian+URI
 */

export function buildNewNoteUri({ vaultName, path, content }) {
  const params = new URLSearchParams();
  if (vaultName) params.set("vault", vaultName);
  if (path) params.set("file", path);
  if (content) params.set("content", content);
  return `obsidian://new?${params.toString()}`;
}

export function buildOpenUri({ vaultName, path }) {
  const params = new URLSearchParams();
  if (vaultName) params.set("vault", vaultName);
  if (path) params.set("file", path);
  return `obsidian://open?${params.toString()}`;
}
