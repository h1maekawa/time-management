/**
 * この端末を識別するための、ブラウザに保存する不透明なID（§77: devices Tableとの紐付け）。
 * アカウント/PIIとは無関係のランダム値。端末ごとに1つ、初回アクセス時に作って使い回す。
 */

const KEY = "timebox-os/device-id";

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function browserStorage() {
  try {
    const test = "__timebox_device_probe__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

let memoryDeviceId = null;

export function getDeviceId() {
  const store = browserStorage();
  if (!store) {
    if (!memoryDeviceId) memoryDeviceId = randomId();
    return memoryDeviceId;
  }
  let id = store.getItem(KEY);
  if (!id) {
    id = randomId();
    store.setItem(KEY, id);
  }
  return id;
}
