/**
 * sw-roleplay-relay — OpenAI Chat Completions への中継。
 *
 * 目的は2つだけ。
 *   1. APIキーをブラウザに置かずに済ませる（キーはWorkerのsecretに置く）
 *   2. 課金が持ち主に来るので、使いすぎを仕組みで止める
 *
 * 中継するのは POST /v1/chat/completions のみ。ストリーミングはそのまま素通しし、
 * 通り抜けざまに出力トークン数だけ数えて日次の予算から引く。
 */

const UPSTREAM = "https://api.openai.com/v1/chat/completions";

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return err(405, "POST only", cors);

    const url = new URL(request.url);
    if (url.pathname !== "/v1/chat/completions") return err(404, "not found", cors);

    // --- 合言葉を先に見る。通っていない相手に設定状態を教えないため ---
    if (!env.ACCESS_CODE) return err(500, "ACCESS_CODE が未設定です", cors);
    const code = request.headers.get("x-access-code") || "";
    if (!timingSafeEqual(code, env.ACCESS_CODE)) return err(401, "合言葉が違います", cors);

    // --- 設定漏れは開いたままにせず落とす（開いた中継を作らないため） ---
    if (!env.OPENAI_API_KEY) return err(500, "OPENAI_API_KEY が未設定です", cors);
    if (!env.USAGE) return err(500, "USAGE の KV が未設定です（使用量を数えられないため停止）", cors);

    // --- リクエストの検査。素通しせず、モデルと上限を絞る ---
    let body;
    try { body = await request.json(); } catch { return err(400, "JSONとして読めません", cors); }

    const allowed = (env.ALLOWED_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(body.model)) {
      return err(400, `このモデルは使えません: ${body.model}`, cors);
    }

    // 出力上限。新しめのモデルは max_completion_tokens 側を見るので両方揃える。
    const cap = int(env.MAX_TOKENS_CAP, 8000);
    const asked = int(body.max_completion_tokens ?? body.max_tokens, cap);
    delete body.max_tokens;
    body.max_completion_tokens = Math.min(asked, cap);

    // ストリーミング時も使用量を返させる（返らないと予算から引けない）
    if (body.stream) body.stream_options = { ...(body.stream_options || {}), include_usage: true };

    // --- 日次の上限 ---
    const day = new Date().toISOString().slice(0, 10);
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipKey = `req:${day}:${ip}`;
    const tokKey = `tok:${day}`;

    const [ipCount, tokUsed] = await Promise.all([
      env.USAGE.get(ipKey).then((v) => int(v, 0)),
      env.USAGE.get(tokKey).then((v) => int(v, 0)),
    ]);

    if (ipCount >= int(env.DAILY_REQUESTS_PER_IP, 30)) {
      return err(429, "本日の利用回数の上限に達しました。明日また試してください。", cors);
    }
    if (tokUsed >= int(env.DAILY_OUTPUT_TOKENS, 60000)) {
      return err(429, "本日の全体の利用量が上限に達しました。明日また試してください。", cors);
    }

    ctx.waitUntil(bump(env.USAGE, ipKey, 1, 60 * 60 * 26));

    // --- 上流へ ---
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    const headers = new Headers(cors);
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");

    if (!upstream.ok || !upstream.body) {
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    // 素通ししながら出力トークンだけ数える。数え損ねても会話は止めない。
    const [toClient, toCount] = upstream.body.tee();
    ctx.waitUntil(countOutputTokens(toCount, env.USAGE, tokKey));
    return new Response(toClient, { status: upstream.status, headers });
  },
};

/** SSE / JSON のどちらでも completion_tokens を拾って日次カウンタに足す。 */
async function countOutputTokens(stream, kv, key) {
  try {
    const text = await new Response(stream).text();
    let out = 0;
    for (const m of text.matchAll(/"completion_tokens"\s*:\s*(\d+)/g)) {
      out = Math.max(out, parseInt(m[1], 10));
    }
    if (out > 0) await bump(kv, key, out, 60 * 60 * 26);
  } catch { /* 集計の失敗で応答を壊さない */ }
}

async function bump(kv, key, by, ttl) {
  const cur = int(await kv.get(key), 0);
  await kv.put(key, String(cur + by), { expirationTtl: ttl });
}

function corsHeaders(origin, env) {
  const allow = (env.ALLOWED_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allow.includes(origin) ? origin : allow[0] || "null";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Headers": "content-type, authorization, x-access-code, openai-organization, openai-project",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function err(status, message, cors) {
  return new Response(JSON.stringify({ error: { type: "relay_error", message } }), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}

function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

/** 長さも内容も早期returnしない比較。合言葉の推測を助けないため。 */
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
