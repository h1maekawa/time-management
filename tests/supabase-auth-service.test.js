import test from "node:test";
import assert from "node:assert/strict";

import { createAuthService, friendlyAuthErrorMessage, isValidEmail } from "../assets/js/supabase/auth-service.js";

function fakeSupabaseAuth({
  signInWithOtp = async () => ({ error: null }),
  verifyOtp = async () => ({ data: { session: { access_token: "tok" }, user: { id: "u1", email: "a@b.com" } }, error: null }),
  signOut = async () => ({ error: null }),
  getSession = async () => ({ data: { session: null } }),
  onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } }),
} = {}) {
  return { auth: { signInWithOtp, verifyOtp, signOut, getSession, onAuthStateChange } };
}

test("isValidEmail: 形式チェック", () => {
  assert.equal(isValidEmail("a@b.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail(""), false);
  assert.equal(isValidEmail(undefined), false);
});

test("friendlyAuthErrorMessage: 技術的なエラーを日本語の案内文へ変換する（技術文言をそのまま出さない）", () => {
  assert.match(friendlyAuthErrorMessage("Invalid token"), /確認コードが正しくありません/);
  assert.match(friendlyAuthErrorMessage("Token has expired"), /有効期限/);
  assert.match(friendlyAuthErrorMessage("Too many requests, rate limit exceeded"), /時間をおいて/);
  assert.match(friendlyAuthErrorMessage("network error"), /通信に失敗/);
  assert.match(friendlyAuthErrorMessage("something totally unknown"), /エラーが発生しました/);
});

test("createAuthService: 未設定(getClientがnullを返す)場合はnot_configuredを返し、例外を投げない", async () => {
  const service = createAuthService({ getClient: async () => null });
  assert.deepEqual(await service.sendOtp("a@b.com"), {
    ok: false,
    error: "not_configured",
    message: "Cloud機能は未設定です。",
  });
  assert.deepEqual(await service.verifyOtp("a@b.com", "123456"), {
    ok: false,
    error: "not_configured",
    message: "Cloud機能は未設定です。",
  });
  assert.equal(await service.getSession(), null);
});

test("sendOtp: 不正なメール形式はSupabaseへ問い合わせずに弾く", async () => {
  let called = false;
  const client = fakeSupabaseAuth({ signInWithOtp: async () => ((called = true), { error: null }) });
  const service = createAuthService({ getClient: async () => client });
  const result = await service.sendOtp("not-an-email");
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("sendOtp: 成功時はok:trueを返す", async () => {
  const client = fakeSupabaseAuth();
  const service = createAuthService({ getClient: async () => client });
  const result = await service.sendOtp("a@b.com", { captchaToken: "tkn" });
  assert.equal(result.ok, true);
});

test("sendOtp: Supabase側エラーは日本語メッセージに変換して返す", async () => {
  const client = fakeSupabaseAuth({
    signInWithOtp: async () => ({ error: { message: "Too many requests" } }),
  });
  const service = createAuthService({ getClient: async () => client });
  const result = await service.sendOtp("a@b.com");
  assert.equal(result.ok, false);
  assert.match(result.message, /時間をおいて/);
});

test("verifyOtp: 6桁以外は問い合わせずに弾く", async () => {
  let called = false;
  const client = fakeSupabaseAuth({ verifyOtp: async () => ((called = true), {}) });
  const service = createAuthService({ getClient: async () => client });
  const result = await service.verifyOtp("a@b.com", "123");
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("verifyOtp: 成功時はsession/userを返す", async () => {
  const client = fakeSupabaseAuth();
  const service = createAuthService({ getClient: async () => client });
  const result = await service.verifyOtp("a@b.com", "123456");
  assert.equal(result.ok, true);
  assert.equal(result.user.id, "u1");
  assert.equal(result.session.access_token, "tok");
});

test("verifyOtp: 誤ったコードは日本語メッセージを返す", async () => {
  const client = fakeSupabaseAuth({
    verifyOtp: async () => ({ data: {}, error: { message: "Invalid OTP" } }),
  });
  const service = createAuthService({ getClient: async () => client });
  const result = await service.verifyOtp("a@b.com", "000000");
  assert.equal(result.ok, false);
  assert.match(result.message, /確認コードが正しくありません/);
});

test("signOut: 未設定でも例外を投げずok:trueを返す（Guestに影響しない）", async () => {
  const service = createAuthService({ getClient: async () => null });
  assert.deepEqual(await service.signOut(), { ok: true });
});

test("getUser: セッションが無ければnull", async () => {
  const client = fakeSupabaseAuth({ getSession: async () => ({ data: { session: null } }) });
  const service = createAuthService({ getClient: async () => client });
  assert.equal(await service.getUser(), null);
});

test("onAuthStateChange: 未設定時はダミーunsubscribeを返し、例外を投げない", async () => {
  const service = createAuthService({ getClient: async () => null });
  const sub = await service.onAuthStateChange(() => {});
  assert.equal(typeof sub.unsubscribe, "function");
  sub.unsubscribe();
});
