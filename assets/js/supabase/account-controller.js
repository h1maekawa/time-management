/**
 * Account Controller — Auth / Guest→Account Migration / Local+Cloud Merge / Account Delete の
 * 状態と手続きをひとつにまとめたコントローラ。timebox.js（画面描画）から呼ばれる。
 *
 * 「考えることを減らす」というDAYLOOPのコンセプト通り、利用者からは
 *  ログイン = メール + 6桁コード、Account = Data が自動的に紐づく、Sync = 意識しない
 * という単純な体験に見えるようにし、複雑さ（namespace切り替え・version・merge判断）は
 * ここへ閉じ込める。
 */
import { createAuthService, isValidEmail } from "./auth-service.js";
import { sanitizeDigits, canResend, resendCooldownRemainingSeconds } from "./otp-input.js";
import { snapshotState, countEntities, decideMigrationScenario, mergeLocalAndCloudState } from "./migration.js";
import * as storage from "../timebox-storage.js";
import { getProvider } from "../storage-providers/registry.js";
import { setActiveUser as setCloudActiveUser } from "../storage-providers/cloud-provider.js";
import { enqueueOp, peekAll, clearQueue } from "./offline-queue.js";

function initialState() {
  return {
    status: "guest", // guest | authenticated
    user: null, // { id, email }
    loginModalOpen: false,
    loginStep: "email", // email | otp
    loginEmail: "",
    loginError: "",
    otpError: "",
    otpSubmitting: false,
    emailSubmitting: false,
    lastOtpSentAt: null,
    migrationPrompt: null, // { scenario, localCount, cloudCount }
    accountMenuOpen: false,
    deleteStep: 0, // 0: none, 1: 一段階目確認, 2: 二段階目（最終）確認
    deleteSubmitting: false,
    deleteError: "",
  };
}

export function createAccountController({ onChange, authService = createAuthService(), cloudProvider } = {}) {
  let state = initialState();
  const provider = cloudProvider ?? getProvider("cloud");

  function set(patch) {
    state = { ...state, ...patch };
    onChange?.(state);
  }

  function getState() {
    return state;
  }

  /** ログイン直後の namespace切り替え + Migration判定。Cloudへは自動で書き込まない。 */
  async function handleLoginEstablished(user) {
    setCloudActiveUser(user.id);
    const guestLocal = storage.load(); // まだguest namespace のまま読む
    const localSnapshot = snapshotState(guestLocal);
    const localCounts = countEntities(localSnapshot);

    let cloudTaskCount = 0;
    try {
      const cloudState = await provider.loadState({}, { namespace: storage.userNamespace(user.id) });
      cloudTaskCount = cloudState?.tasks?.length ?? 0;
    } catch {
      cloudTaskCount = 0;
    }

    const scenario = decideMigrationScenario({
      localTaskCount: localCounts.tasks,
      cloudTaskCount,
    });

    set({
      status: "authenticated",
      user: { id: user.id, email: user.email },
      loginModalOpen: false,
      migrationPrompt:
        scenario === "empty-both"
          ? null
          : { scenario, localCount: localCounts.tasks, cloudCount: cloudTaskCount, localSnapshot },
    });

    if (scenario === "empty-both" || scenario === "empty-local") {
      // Cloudにしか（あるいはどちらにも）データが無いなら、そのままCloudを使い始めてよい。
      await switchToCloudNamespace(user.id, { pullFromCloud: scenario === "empty-local" });
    }
  }

  async function switchToCloudNamespace(userId, { seedState, pullFromCloud } = {}) {
    const namespace = storage.userNamespace(userId);
    storage.setActiveNamespace(namespace);
    if (pullFromCloud) {
      const cloudState = await provider.loadState({}, { namespace });
      if (cloudState) storage.save(cloudState);
    } else if (seedState) {
      storage.save(seedState);
    }
    const current = storage.load();
    storage.save({
      ...current,
      settings: { ...current.settings, storageProviderId: "cloud" },
    });
  }

  /** 「アカウントへ引き継ぐ」§19: Guestの内容をコピーしてCloudへ */
  async function migrateGuestToCloud() {
    if (!state.user || !state.migrationPrompt) return;
    const { localSnapshot } = state.migrationPrompt;
    await switchToCloudNamespace(state.user.id, { seedState: localSnapshot });
    const result = await provider.saveState(storage.load(), {}, { namespace: storage.userNamespace(state.user.id) });
    set({ migrationPrompt: null });
    return result;
  }

  /** 「この端末のまま使う」: Cloudへは何もせず、Guest local(legacy key)のまま継続する */
  function keepLocalOnly() {
    set({ migrationPrompt: null });
  }

  /** 「内容を統合」§20 */
  async function mergeLocalAndCloud() {
    if (!state.user || !state.migrationPrompt) return;
    const { localSnapshot } = state.migrationPrompt;
    const namespace = storage.userNamespace(state.user.id);
    const cloudState = (await provider.loadState({}, { namespace })) ?? storage.emptyState();
    const merged = mergeLocalAndCloudState(localSnapshot, cloudState);

    storage.setActiveNamespace(namespace);
    storage.save({ ...merged, settings: { ...localSnapshot.settings, storageProviderId: "cloud" } });
    const result = await provider.saveState(storage.load(), {}, { namespace });
    set({ migrationPrompt: null });
    return result;
  }

  /** 「Cloudを使用」 */
  async function useCloudOnly() {
    if (!state.user) return;
    await switchToCloudNamespace(state.user.id, { pullFromCloud: true });
    set({ migrationPrompt: null });
  }

  /** 「この端末を使用」: ローカルを正としてCloudへ上書きpushする（利用者の明示的な選択） */
  async function useLocalOnly() {
    if (!state.user || !state.migrationPrompt) return;
    const { localSnapshot } = state.migrationPrompt;
    await switchToCloudNamespace(state.user.id, { seedState: localSnapshot });
    const result = await provider.saveState(storage.load(), {}, { namespace: storage.userNamespace(state.user.id) });
    set({ migrationPrompt: null });
    return result;
  }

  function handleLogout() {
    setCloudActiveUser(null);
    storage.setActiveNamespace(null); // Guest State へ戻る。Account Cacheは残るが表示しない
    set({ ...initialState(), status: "guest" });
  }

  return {
    getState,

    async init() {
      const session = await authService.getSession();
      if (session?.user) {
        await handleLoginEstablished(session.user);
      }
      authService.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN" && session?.user) {
          await handleLoginEstablished(session.user);
        } else if (event === "SIGNED_OUT") {
          handleLogout();
        }
      });
    },

    isCloudAvailable: authService.isConfigured,

    openLoginModal() {
      set({ loginModalOpen: true, loginStep: "email", loginError: "", otpError: "" });
    },
    closeLoginModal() {
      set({ loginModalOpen: false });
    },
    continueAsGuest() {
      set({ loginModalOpen: false });
    },

    /**
     * STEP 1。emailはDOMから直接読んで渡してもらう（他の入力欄と同じ既存の流儀。
     * timebox.js参照）。ここでは毎キー入力のたびにreactive stateへ反映しない＝
     * OTP入力中のフォーカス喪失を避けるための設計判断。
     */
    async submitEmail(rawEmail, captchaToken) {
      const email = String(rawEmail ?? "").trim();
      if (!isValidEmail(email)) {
        set({ loginError: "メールアドレスの形式が正しくありません。" });
        return { ok: false };
      }
      set({ emailSubmitting: true, loginError: "", loginEmail: email });
      const result = await authService.sendOtp(email, { captchaToken });
      if (!result.ok) {
        set({ emailSubmitting: false, loginError: result.message });
        return result;
      }
      set({
        emailSubmitting: false,
        loginStep: "otp",
        otpError: "",
        lastOtpSentAt: new Date().toISOString(),
      });
      return result;
    },

    async resendOtp(captchaToken) {
      if (!canResend(state.lastOtpSentAt)) return { ok: false };
      return this.submitEmail(state.loginEmail, captchaToken);
    },

    resendCooldownRemaining() {
      return resendCooldownRemainingSeconds(state.lastOtpSentAt);
    },

    changeEmail() {
      set({ loginStep: "email", otpError: "" });
    },

    async submitOtp(rawCode) {
      const code = sanitizeDigits(rawCode);
      if (code.length !== 6) {
        set({ otpError: "6桁すべて入力してください。" });
        return { ok: false };
      }
      set({ otpSubmitting: true, otpError: "" });
      const result = await authService.verifyOtp(state.loginEmail.trim(), code);
      if (!result.ok) {
        set({ otpSubmitting: false, otpError: result.message });
        return result;
      }
      if (result.user) {
        await handleLoginEstablished(result.user);
      }
      set({ otpSubmitting: false });
      return result;
    },

    toggleAccountMenu(open) {
      set({ accountMenuOpen: open ?? !state.accountMenuOpen });
    },

    async signOut() {
      await authService.signOut();
      handleLogout();
    },

    /** 設定画面の「Cloudにする」から、ログイン後いつでも再度Cloud接続を試みる */
    async connectCloudNow() {
      if (!state.user) return;
      const guestLocal = storage.load();
      const localCounts = countEntities(guestLocal);
      let cloudTaskCount = 0;
      try {
        const cloudState = await provider.loadState({}, { namespace: storage.userNamespace(state.user.id) });
        cloudTaskCount = cloudState?.tasks?.length ?? 0;
      } catch {
        cloudTaskCount = 0;
      }
      const scenario = decideMigrationScenario({ localTaskCount: localCounts.tasks, cloudTaskCount });
      if (scenario === "empty-both" || scenario === "empty-local") {
        await switchToCloudNamespace(state.user.id, { pullFromCloud: scenario === "empty-local" });
        return;
      }
      set({
        migrationPrompt: {
          scenario,
          localCount: localCounts.tasks,
          cloudCount: cloudTaskCount,
          localSnapshot: snapshotState(guestLocal),
        },
      });
    },

    chooseMigration(choice) {
      if (choice === "migrate") return migrateGuestToCloud();
      if (choice === "keep-local") return keepLocalOnly();
      if (choice === "merge") return mergeLocalAndCloud();
      if (choice === "use-cloud") return useCloudOnly();
      if (choice === "use-local") return useLocalOnly();
      return undefined;
    },

    startAccountDelete() {
      set({ deleteStep: 1, deleteError: "" });
    },
    confirmAccountDeleteStep() {
      set({ deleteStep: 2, deleteError: "" });
    },
    cancelAccountDelete() {
      set({ deleteStep: 0, deleteError: "" });
    },

    async finalizeAccountDelete() {
      set({ deleteSubmitting: true, deleteError: "" });
      try {
        const session = await authService.getSession();
        if (!session?.access_token) {
          set({ deleteSubmitting: false, deleteError: "ログインしてください。" });
          return { ok: false };
        }
        const response = await fetch("/api/account/delete", {
          method: "POST",
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) {
          set({ deleteSubmitting: false, deleteError: "アカウントの削除に失敗しました。" });
          return { ok: false };
        }
        await authService.signOut();
        handleLogout();
        return { ok: true };
      } catch {
        set({ deleteSubmitting: false, deleteError: "通信に失敗しました。しばらくしてから、もう一度お試しください。" });
        return { ok: false };
      }
    },

    /** オンライン復帰時に呼ぶ。オフライン中に溜まったCloud再送要求をまとめて片付ける印を返す */
    queueOfflineResync() {
      if (!state.user) return;
      enqueueOp(storage.userNamespace(state.user.id), { kind: "resync", payload: {} });
    },
    pendingOfflineOps() {
      if (!state.user) return [];
      return peekAll(storage.userNamespace(state.user.id));
    },
    clearOfflineQueue() {
      if (!state.user) return;
      clearQueue(storage.userNamespace(state.user.id));
    },
  };
}
