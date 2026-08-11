/**
 * Offline Queue — オフライン中のCloud書き込みを永続化して憶えておき、オンライン復帰後に
 * 順番に再送するための最小限のキュー。
 *
 * ネットワーク層には触れない（enqueue/dequeueAll/peekAllのみ）。実際に「今オンラインか」の
 * 判定と再送の実行は呼び出し側（cloud-provider.js / timebox.js）が行う。
 *
 * localStorageが無い環境（Node testやプライベートモード）ではメモリ上にフォールバックする。
 */

const memoryStores = new Map();

function browserStorage() {
  try {
    const test = "__timebox_queue_probe__";
    window.localStorage.setItem(test, "1");
    window.localStorage.removeItem(test);
    return window.localStorage;
  } catch {
    return null;
  }
}

function queueKey(namespace) {
  return `timebox-os/cloud-queue::${namespace || "guest"}`;
}

function readQueue(namespace) {
  const key = queueKey(namespace);
  const store = browserStorage();
  if (!store) return memoryStores.get(key) ?? [];
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(namespace, queue) {
  const key = queueKey(namespace);
  const store = browserStorage();
  if (!store) {
    memoryStores.set(key, queue);
    return;
  }
  try {
    store.setItem(key, JSON.stringify(queue));
  } catch {
    memoryStores.set(key, queue);
  }
}

let seq = 0;

/**
 * @param {string} namespace guest / user/<uid>
 * @param {{ kind: string, payload: object }} op
 */
export function enqueueOp(namespace, op) {
  const queue = readQueue(namespace);
  seq += 1;
  const entry = {
    opId: `q${Date.now().toString(36)}${seq.toString(36)}`,
    kind: op.kind,
    payload: op.payload,
    enqueuedAt: new Date().toISOString(),
  };
  const next = [...queue, entry];
  writeQueue(namespace, next);
  return entry;
}

export function peekAll(namespace) {
  return readQueue(namespace);
}

export function clearQueue(namespace) {
  writeQueue(namespace, []);
}

/** 成功した分のopIdを取り除く（失敗した分は残して再送できるようにする） */
export function removeOps(namespace, opIds) {
  const remove = new Set(opIds);
  const remaining = readQueue(namespace).filter((entry) => !remove.has(entry.opId));
  writeQueue(namespace, remaining);
  return remaining;
}
