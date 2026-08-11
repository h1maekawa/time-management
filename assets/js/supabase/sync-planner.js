/**
 * Sync Planner — Push/Pull/Conflict の判断を行う純粋関数群。
 *
 * DB・ネットワークには一切触れない。cloud-provider.js が
 * 「何をinsert/update/pullするか」を決めるためにここを呼び、実際のSupabase呼び出しは
 * cloud-provider.js側で行う（テストしやすくするための分離。§53）。
 *
 * 楽観的並行制御(Optimistic Concurrency):
 *   各行は version(bigint) を持ち、UPDATE のたびにDBトリガーが +1 する。
 *   Push側は「最後に自分が見たcloud version（knownVersions）」を憶えておき、
 *   それが今のcloud versionと一致する場合だけ安全に上書きできると判断する。
 *   一致しなければ「別端末で更新された」= conflict として扱い、上書きしない。
 */

/**
 * @param {Array<{id:string}>} localItems ローカルの最新エンティティ一覧（cloud行の形にmapping済み。idを含む）
 * @param {Array<{id:string, version:number}>} cloudRows 現在のCloud側の行（idとversionだけあれば良い）
 * @param {Record<string, number>} knownVersions 前回同期時に確認したcloud version（id -> version）
 * @returns {{ inserts: object[], updates: {id:string, expectedVersion:number, item:object}[], conflicts: string[] }}
 */
export function planPush({ localItems = [], cloudRows = [], knownVersions = {} } = {}) {
  const cloudById = new Map(cloudRows.map((row) => [row.id, row]));
  const inserts = [];
  const updates = [];
  const conflicts = [];

  for (const item of localItems) {
    const cloudRow = cloudById.get(item.id);
    if (!cloudRow) {
      inserts.push(item);
      continue;
    }
    const known = knownVersions[item.id];
    if (known === undefined || known === cloudRow.version) {
      updates.push({ id: item.id, expectedVersion: cloudRow.version, item });
    } else {
      conflicts.push(item.id);
    }
  }

  return { inserts, updates, conflicts };
}

/**
 * どのCloud行をローカルへ取り込むべきか（他端末での変更やdeleteを含む）を判断する。
 * @param {Array<{id:string, version:number, deleted_at?:string|null}>} cloudRows
 * @param {Record<string, number>} knownVersions
 * @returns {{ toApply: object[], toRemove: string[], nextKnownVersions: Record<string, number> }}
 */
export function planPull({ cloudRows = [], knownVersions = {} } = {}) {
  const toApply = [];
  const toRemove = [];
  const nextKnownVersions = { ...knownVersions };

  for (const row of cloudRows) {
    const known = knownVersions[row.id];
    if (known === row.version) continue; // 変化なし
    if (row.deleted_at) {
      toRemove.push(row.id);
    } else {
      toApply.push(row);
    }
    nextKnownVersions[row.id] = row.version;
  }

  return { toApply, toRemove, nextKnownVersions };
}

/**
 * push後、成功した書き込みぶんだけ knownVersions を更新する。
 * insert成功 → version 1。update成功 → expectedVersion + 1（DBトリガーがちょうど+1するため）。
 */
export function nextKnownVersionsAfterPush({ knownVersions = {}, insertedIds = [], updatedIds = [] }) {
  const next = { ...knownVersions };
  for (const id of insertedIds) next[id] = 1;
  for (const id of updatedIds) {
    const before = next[id];
    next[id] = (typeof before === "number" ? before : 0) + 1;
  }
  return next;
}
