/**
 * 「前回同期時に見たCloud側のversion」を端末に永続化するための小さなKVS。
 * sync-planner.js の楽観的並行制御が、次回の同期でどの行が他端末で変わったかを
 * 判定するために使う。namespace(guest / user/<uid>)ごとに分離する（§39）。
 */

const memoryStores = new Map();

function browserStorage() {
  try {
    const test = "__timebox_versions_probe__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

function versionsKey(namespace) {
  return `timebox-os/cloud-versions::${namespace || "guest"}`;
}

export function loadKnownVersions(namespace) {
  const key = versionsKey(namespace);
  const store = browserStorage();
  if (!store) return memoryStores.get(key) ?? {};
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveKnownVersions(namespace, versions) {
  const key = versionsKey(namespace);
  const store = browserStorage();
  if (!store) {
    memoryStores.set(key, versions);
    return;
  }
  try {
    store.setItem(key, JSON.stringify(versions));
  } catch {
    memoryStores.set(key, versions);
  }
}

export function getKindVersions(namespace, kind) {
  const all = loadKnownVersions(namespace);
  return all[kind] ?? {};
}

export function setKindVersions(namespace, kind, kindVersions) {
  const all = loadKnownVersions(namespace);
  saveKnownVersions(namespace, { ...all, [kind]: kindVersions });
}
