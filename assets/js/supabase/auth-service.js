/**
 * DAYLOOP Auth Service — Supabase Auth (Email OTP) のラッパー。
 *
 * Primary Authentication は Email OTP（6桁コード）のみ。Passwordは導入しない。
 * Canonical User IDは auth.users.id (uuid)。アプリ独自のUser IDは作らない。
 *
 * テスト容易性のため、実クライアントを直接importせず `getClient` を注入できるようにする
 * （デフォルトは ./client.js の getSupabaseClient）。テストでは fake client を渡すことで、
 * ネットワークに触れずに OTP送信/検証/ログアウト/セッション監視のロジックを検証できる。
 */
import { getSupabaseClient, isSupabaseConfigured } from "./client.js";

const NOT_CONFIGURED = { ok: false, error: "not_configured", message: "Cloud機能は未設定です。" };

/**
 * Supabase / GoTrue の生のエラーメッセージを、利用者向けの日本語メッセージへ変換する。
 * 技術的な文言（Invalid token 等）をそのまま出さない（§16）。
 */
export function friendlyAuthErrorMessage(rawMessage) {
  const message = String(rawMessage ?? "").toLowerCase();

  if (message.includes("rate limit") || message.includes("too many")) {
    return "少し時間をおいてから、もう一度お試しください。";
  }
  if (message.includes("expired")) {
    return "確認コードの有効期限が切れました。再送してもう一度お試しください。";
  }
  if (
    message.includes("invalid") ||
    message.includes("token") ||
    message.includes("otp") ||
    message.includes("code")
  ) {
    return "確認コードが正しくありません。";
  }
  if (message.includes("captcha")) {
    return "確認に失敗しました。ページを再読み込みしてもう一度お試しください。";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "通信に失敗しました。しばらくしてから、もう一度お試しください。";
  }
  return "エラーが発生しました。もう一度お試しください。";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email.trim());
}

export function createAuthService({ getClient = getSupabaseClient } = {}) {
  let listeners = new Set();
  let unsubscribeRaw = null;

  async function client() {
    return getClient();
  }

  return {
    isConfigured: isSupabaseConfigured,

    /** STEP 1: メールへ6桁コードを送る。未登録なら新規Account、既存ならLoginを兼ねる。 */
    async sendOtp(email, { captchaToken } = {}) {
      if (!isValidEmail(email)) {
        return { ok: false, error: "invalid_email", message: "メールアドレスの形式が正しくありません。" };
      }
      const supabase = await client();
      if (!supabase) return NOT_CONFIGURED;

      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          captchaToken: captchaToken || undefined,
        },
      });

      if (error) {
        return { ok: false, error: "send_failed", message: friendlyAuthErrorMessage(error.message) };
      }
      return { ok: true };
    },

    /** STEP 2: 6桁コードを検証する。成功時、未登録Emailなら自動でAccountが作られる。 */
    async verifyOtp(email, token) {
      if (!isValidEmail(email)) {
        return { ok: false, error: "invalid_email", message: "メールアドレスの形式が正しくありません。" };
      }
      if (!/^\d{6}$/.test(String(token ?? ""))) {
        return { ok: false, error: "invalid_code", message: "確認コードが正しくありません。" };
      }
      const supabase = await client();
      if (!supabase) return NOT_CONFIGURED;

      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: String(token),
        type: "email",
      });

      if (error) {
        return { ok: false, error: "verify_failed", message: friendlyAuthErrorMessage(error.message) };
      }
      return { ok: true, session: data?.session ?? null, user: data?.user ?? null };
    },

    async signOut() {
      const supabase = await client();
      if (!supabase) return { ok: true };
      const { error } = await supabase.auth.signOut();
      if (error) return { ok: false, message: friendlyAuthErrorMessage(error.message) };
      return { ok: true };
    },

    async getSession() {
      const supabase = await client();
      if (!supabase) return null;
      const { data } = await supabase.auth.getSession();
      return data?.session ?? null;
    },

    async getUser() {
      const session = await this.getSession();
      return session?.user ?? null;
    },

    /**
     * セッション変化(ログイン/ログアウト/トークン更新)を監視する。
     * 戻り値の unsubscribe() を呼ぶまで購読し続ける。未設定時は何もしないダミーを返す。
     */
    async onAuthStateChange(callback) {
      listeners.add(callback);
      const supabase = await client();
      if (!supabase) {
        return { unsubscribe: () => listeners.delete(callback) };
      }
      if (!unsubscribeRaw) {
        const { data } = supabase.auth.onAuthStateChange((event, session) => {
          for (const fn of listeners) fn(event, session);
        });
        unsubscribeRaw = () => data?.subscription?.unsubscribe?.();
      }
      return {
        unsubscribe: () => {
          listeners.delete(callback);
          if (listeners.size === 0 && unsubscribeRaw) {
            unsubscribeRaw();
            unsubscribeRaw = null;
          }
        },
      };
    },
  };
}
