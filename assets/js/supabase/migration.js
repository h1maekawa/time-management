/**
 * Guest → Account Migration / Local + Cloud Merge の純粋ロジック。
 *
 * ここではSupabaseやlocalStorageに直接触れない。「何をすべきか」を決めるだけで、
 * 実際の読み書きは cloud-provider.js / timebox.js 側が行う。
 * これにより、migration の判断ロジックをネットワーク無しでテストできる（§52/§53）。
 *
 * 安全性の原則（§21）:
 *   - Migration前には必ずスナップショットを取る（snapshotState）。
 *   - Migration失敗時、既存のLocal Dataは一切変更しない
 *     （呼び出し側はローカルへの書き込みをCloudへの書き込みが完了するまで行わない）。
 *   - Cloudへの書き込みはid付きのupsertのみで行うため冪等（idempotent）。
 *     途中で失敗しても、同じMigrationをもう一度実行するだけで安全に再開できる
 *     （補償(compensating)用の特別なロールバックSQLを持たずに済む）。
 */

/** ローカルStateのスナップショットを取る（副作用なしの深いコピー） */
export function snapshotState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function countEntities(state) {
  return {
    tasks: state?.tasks?.length ?? 0,
    captures: state?.captures?.length ?? 0,
    executions: state?.executions?.length ?? 0,
    skills: state?.skills?.length ?? 0,
    automationCandidates: state?.automationCandidates?.length ?? 0,
  };
}

/**
 * ログイン直後、Local(Guest)とCloudのどちらにデータがあるかで取るべきシナリオを決める。
 * @returns {"empty-both"|"empty-cloud"|"empty-local"|"both-have-data"}
 */
export function decideMigrationScenario({ localTaskCount = 0, cloudTaskCount = 0 } = {}) {
  if (localTaskCount === 0 && cloudTaskCount === 0) return "empty-both";
  if (localTaskCount > 0 && cloudTaskCount === 0) return "empty-cloud";
  if (localTaskCount === 0 && cloudTaskCount > 0) return "empty-local";
  return "both-have-data";
}

function timeOf(item) {
  return item?.updatedAt || item?.createdAt || "";
}

/**
 * 「内容を統合」用: idが同じならより新しい方を残し、idが異なるものは両方残す。
 * §20 の「絶対に自動上書きしない」は、この関数を呼ぶかどうかを利用者が選ぶことで守る
 * （選択肢: 統合 / Cloudを使用 / この端末を使用、のいずれも明示的な選択）。
 */
export function mergeEntitiesByUnion(localList = [], cloudList = []) {
  const byId = new Map();
  for (const item of localList) byId.set(item.id, item);
  for (const item of cloudList) {
    const existing = byId.get(item.id);
    if (!existing || timeOf(item) >= timeOf(existing)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

/**
 * Local State と Cloud State（同じ形へmapping済み）を統合した新しいStateを作る。
 * tasks/captures/executions/skills/automationCandidates を統合し、
 * days(windows/blocks)・templateはローカルを優先する（端末固有の時間割編集を尊重）。
 */
export function mergeLocalAndCloudState(localState, cloudState) {
  return {
    ...localState,
    tasks: mergeEntitiesByUnion(localState.tasks, cloudState.tasks ?? []),
    captures: mergeEntitiesByUnion(localState.captures, cloudState.captures ?? []),
    executions: mergeEntitiesByUnion(localState.executions, cloudState.executions ?? []),
    skills: mergeEntitiesByUnion(localState.skills, cloudState.skills ?? []),
    automationCandidates: mergeEntitiesByUnion(
      localState.automationCandidates,
      cloudState.automationCandidates ?? []
    ),
  };
}
