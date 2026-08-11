import test from "node:test";
import assert from "node:assert/strict";

import { createAccountController } from "../assets/js/supabase/account-controller.js";
import * as storage from "../assets/js/timebox-storage.js";

function fakeAuthService({ session = null } = {}) {
  let currentSession = session;
  const listeners = new Set();
  return {
    isConfigured: () => true,
    async getSession() {
      return currentSession;
    },
    async sendOtp(email) {
      if (!email.includes("@")) return { ok: false, message: "メールアドレスの形式が正しくありません。" };
      return { ok: true };
    },
    async verifyOtp(email, code) {
      if (code !== "123456") return { ok: false, message: "確認コードが正しくありません。" };
      const user = { id: "user-1", email };
      currentSession = { user, access_token: "tok" };
      for (const fn of listeners) fn("SIGNED_IN", currentSession);
      return { ok: true, user, session: currentSession };
    },
    async signOut() {
      currentSession = null;
      for (const fn of listeners) fn("SIGNED_OUT", null);
      return { ok: true };
    },
    async onAuthStateChange(cb) {
      listeners.add(cb);
      return { unsubscribe: () => listeners.delete(cb) };
    },
  };
}

function fakeCloudProvider({ cloudTasks = [] } = {}) {
  const calls = { saveState: 0, loadState: 0 };
  return {
    calls,
    async loadState() {
      calls.loadState += 1;
      return { tasks: cloudTasks, captures: [], executions: [], skills: [], automationCandidates: [], days: {} };
    },
    async saveState() {
      calls.saveState += 1;
      return { ok: true };
    },
  };
}

test.beforeEach(() => {
  storage.setActiveNamespace(null);
  storage.clearAll();
});

test("guest mode: セッションが無ければstatusはguestのまま、例外を投げない", async () => {
  const authService = fakeAuthService({ session: null });
  const cloudProvider = fakeCloudProvider();
  const account = createAccountController({ authService, cloudProvider, onChange: () => {} });
  await account.init();
  assert.equal(account.getState().status, "guest");
});

test("submitEmail: 不正な形式はエラーを表示しCloudへ問い合わせない", async () => {
  const authService = fakeAuthService();
  const account = createAccountController({ authService, cloudProvider: fakeCloudProvider(), onChange: () => {} });
  const result = await account.submitEmail("invalid");
  assert.equal(result.ok, false);
  assert.ok(account.getState().loginError);
});

test("submitEmail → submitOtp: 成功するとstepがemail→otpへ進み、最終的にauthenticatedになる", async () => {
  const authService = fakeAuthService();
  const account = createAccountController({ authService, cloudProvider: fakeCloudProvider(), onChange: () => {} });

  const sendResult = await account.submitEmail("test@example.com");
  assert.equal(sendResult.ok, true);
  assert.equal(account.getState().loginStep, "otp");

  const badOtp = await account.submitOtp("000000");
  assert.equal(badOtp.ok, false);
  assert.ok(account.getState().otpError);

  const goodOtp = await account.submitOtp("123456");
  assert.equal(goodOtp.ok, true);
  assert.equal(account.getState().status, "authenticated");
  assert.equal(account.getState().user.email, "test@example.com");
});

test("CASE B相当: Guestに12件、Cloudが空の場合は自動移行せずmigrationPromptを立てる（§19: 自動実行しない）", async () => {
  storage.setActiveNamespace(null);
  const seedTasks = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `task${i}` }));
  storage.save({ ...storage.load(), tasks: seedTasks });

  const authService = fakeAuthService();
  const cloudProvider = fakeCloudProvider({ cloudTasks: [] });
  const account = createAccountController({ authService, cloudProvider, onChange: () => {} });

  await account.submitEmail("test@example.com");
  await account.submitOtp("123456");

  const state = account.getState();
  assert.equal(state.migrationPrompt.scenario, "empty-cloud");
  assert.equal(state.migrationPrompt.localCount, 12);
  assert.equal(cloudProvider.calls.saveState, 0); // まだ何も自動送信していない

  storage.setActiveNamespace(null);
  storage.clearAll();
});

test("chooseMigration('migrate'): 引き継ぎを選ぶとCloudへpushされ、migrationPromptが消える", async () => {
  storage.setActiveNamespace(null);
  storage.save({ ...storage.load(), tasks: [{ id: "t1", title: "task" }] });

  const authService = fakeAuthService();
  const cloudProvider = fakeCloudProvider({ cloudTasks: [] });
  const account = createAccountController({ authService, cloudProvider, onChange: () => {} });

  await account.submitEmail("test@example.com");
  await account.submitOtp("123456");
  assert.ok(account.getState().migrationPrompt);

  await account.chooseMigration("migrate");
  assert.equal(account.getState().migrationPrompt, null);
  assert.equal(cloudProvider.calls.saveState, 1);

  storage.setActiveNamespace(null);
  storage.clearAll();
});

test("signOut: guestへ戻り、namespaceもguestへ戻る（Account Cacheはguest画面へ出さない）", async () => {
  const authService = fakeAuthService();
  const cloudProvider = fakeCloudProvider();
  const account = createAccountController({ authService, cloudProvider, onChange: () => {} });

  await account.submitEmail("test@example.com");
  await account.submitOtp("123456");
  assert.equal(account.getState().status, "authenticated");

  await account.signOut();
  assert.equal(account.getState().status, "guest");
  assert.equal(storage.getActiveNamespace(), null);
});
