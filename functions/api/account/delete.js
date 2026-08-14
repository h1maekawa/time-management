/**
 * POST /api/account/delete
 *
 * Account Delete（§37）。実際の auth.users 削除は、service_role を持つこの
 * trusted server（Cloudflare Pages Function）からのみ行う。service_role key は
 * Frontendへ絶対に渡さない（Cloudflare Pagesの環境変数/SecretとしてSUPABASE_SERVICE_ROLE_KEY /
 * SUPABASE_URL を設定する。このリポジトリにはコミットしない）。
 *
 * Authorization: Bearer <access_token> を要求する。トークンの持ち主自身のUser IDだけを
 * 削除対象にする（Bodyで任意のuser_idを渡させて他人を削除できないようにする）。
 * DB上の user_id 参照テーブルは `on delete cascade` のため、auth.users 削除に連動して
 * profiles / tasks / captures 等のUser Dataも削除される。
 *
 * ここでは @supabase/supabase-js を使わず、Auth の REST API を fetch で直接叩いている。
 * SDKをWorkerへバンドルすると http / crypto / process といったNode組み込みモジュールが
 * 取り込まれ、nodejs_compat が無い環境ではPages Functionsのビルドが通らないため。
 * 呼ぶのは2本だけなので、SDKを持ち込む利点がない。
 */

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "not_configured", message: "アカウント削除機能は未設定です。" }, 501);
  }

  const authHeader = request.headers.get("authorization") || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!accessToken) {
    return json({ error: "unauthorized", message: "ログインが必要です。" }, 401);
  }

  const base = String(supabaseUrl).replace(/\/+$/, "");

  // 1) トークンの持ち主を確認する。ここで得たIDだけを削除対象にする。
  let userId;
  try {
    const meResponse = await fetch(`${base}/auth/v1/user`, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (!meResponse.ok) {
      return json({ error: "unauthorized", message: "ログインが必要です。" }, 401);
    }
    const user = await meResponse.json();
    userId = user?.id;
  } catch {
    return json({ error: "delete_failed", message: "アカウントの削除に失敗しました。" }, 500);
  }

  if (!userId) {
    return json({ error: "unauthorized", message: "ログインが必要です。" }, 401);
  }

  // 2) service_role でトークンの持ち主自身だけを削除する。
  try {
    const deleteResponse = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!deleteResponse.ok) {
      return json({ error: "delete_failed", message: "アカウントの削除に失敗しました。" }, 500);
    }
  } catch {
    return json({ error: "delete_failed", message: "アカウントの削除に失敗しました。" }, 500);
  }

  return json({ ok: true }, 200);
}
