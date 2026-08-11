/**
 * Supabase Client factory（DAYLOOP Cloud / Supabase Auth の入口）。
 *
 * env が無い状態（ローカル開発でSupabase未設定、または `npm run build` をSecretなしで
 * 実行した場合）でもアプリ全体が壊れないよう、ここでは一切例外を投げない。
 * `isSupabaseConfigured()` が false の間、呼び出し側（Auth Service / Cloud Provider）は
 * 「Cloud機能は未設定です」として振る舞う（Guest / Local / Obsidianは使い続けられる）。
 *
 * テスト容易性: `npm test` は実Networkへ依存しない。Auth Service / Cloud Provider は
 * ここから得たクライアントを直接importせず、コンストラクタ引数として受け取れる設計にし、
 * テストでは fake client を注入する（このモジュール自体はテストから直接使わない）。
 *
 * service_role key はここでは絶対に扱わない（Frontend Bundleに含めない。§11）。
 */

function readEnv(key) {
  // Vite以外（node --test など）ではimport.meta.envが存在しないため、無ければ空にする。
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function getSupabaseConfig() {
  const url = readEnv("VITE_SUPABASE_URL");
  // legacy anon key環境ではVITE_SUPABASE_ANON_KEYをfallbackとして許可する（§10）。
  const anonKey = readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") || readEnv("VITE_SUPABASE_ANON_KEY");
  const turnstileSiteKey = readEnv("VITE_TURNSTILE_SITE_KEY");
  return { url, anonKey, turnstileSiteKey };
}

export function isSupabaseConfigured() {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

let clientPromise = null;

/**
 * 実クライアントを遅延生成する。未設定なら null を返す（例外は投げない）。
 * `@supabase/supabase-js` の動的import自体もbuild時のtree-shaking/バンドルには乗るが、
 * 実行はブラウザ内でのみ行われ、Node testからは呼ばれない想定。
 */
export async function getSupabaseClient() {
  if (!isSupabaseConfigured()) return null;
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const { url, anonKey } = getSupabaseConfig();
      return createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
    })();
  }
  return clientPromise;
}

/** テスト/HMR用: シングルトンをリセットする */
export function resetSupabaseClientForTesting() {
  clientPromise = null;
}
