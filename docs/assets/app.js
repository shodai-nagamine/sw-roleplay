import Anthropic from "https://esm.sh/@anthropic-ai/sdk";

/* ============================================================
   連携ロールプレイ
   北谷町の字データを舞台に、ソーシャルワーカーの連携場面を演じ、
   終わったら生態学的視点＋手元の文献で振り返る。
   ============================================================ */

const MODEL = "claude-opus-5";

const ROLES = [
  "医療ソーシャルワーカー（病院）",
  "地域包括支援センターの社会福祉士",
  "相談支援専門員（障害）",
  "介護支援専門員（ケアマネジャー）",
  "訪問看護師",
  "精神科病院の精神保健福祉士",
  "行政（福祉課）の職員",
  "保健所・市町村の保健師",
  "スクールソーシャルワーカー",
  "民生委員",
  "本人",
  "家族（主たる介護者）",
];

const state = {
  client: null,
  areas: null,
  facilities: null,
  knowledge: null,
  area: null,
  myRole: ROLES[0],
  botRole: ROLES[1],
  scenario: "",
  transcript: [],   // {role: 'me'|'bot', text}
  mode: "voice",
  speaking: false,
};

const $ = (id) => document.getElementById(id);

/* ---------- 起動 ---------- */

boot();

async function boot() {
  const [areas, facilities, knowledge] = await Promise.all([
    fetch("data/chatan_areas.geojson").then((r) => r.json()),
    fetch("data/chatan_facilities.geojson").then((r) => r.json()),
    // 知識ベースはローカル起動時のみ（git管理外）。無ければ書誌だけで動かす。
    fetch("data/knowledge.json").then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  state.areas = areas;
  state.facilities = facilities;
  state.knowledge = knowledge;

  fillAreas();
  fillRoles();
  restoreKey();
  reportVoiceSupport();
  bindSetup();

  if (!knowledge) {
    note("文献の知識ベース（knowledge.json）が見つかりません。振り返りは文献の引用なしで行います。"
       + " ローカルで `python3 scripts/build_knowledge.py` を実行すると読み込まれます。");
  }
}

/* ---------- 設定画面 ---------- */

function fillAreas() {
  const sel = $("area");
  const feats = state.areas.features
    .filter((f) => f.properties.pop_2020)
    .sort((a, b) => b.properties.pop_2020 - a.properties.pop_2020);
  sel.innerHTML = feats
    .map((f) => `<option value="${f.properties.key}">${f.properties.label}（${f.properties.pop_2020.toLocaleString()}人）</option>`)
    .join("");
  sel.onchange = () => showAreaFacts(sel.value);
  showAreaFacts(sel.value);
}

function areaByKey(key) {
  return state.areas.features.find((f) => f.properties.key === key);
}

function showAreaFacts(key) {
  const f = areaByKey(key);
  state.area = f;
  const p = f.properties;
  const near = facilitiesNear(f, 700);
  const counts = {};
  for (const x of near) counts[x.properties.category] = (counts[x.properties.category] || 0) + 1;
  $("area-facts").innerHTML = [
    `人口 ${p.pop_2020.toLocaleString()}人`,
    `高齢化率 ${p.ratio_o65}%`,
    `75歳以上 ${p.ratio_o75}%`,
    `年少人口率 ${p.ratio_u15}%`,
    `単身世帯 ${p.hh_single_ratio}%`,
    `高齢者のいる世帯 ${p.hh_with_o65_ratio}%`,
    `2015年比 ${p.pop_change_ratio > 0 ? "+" : ""}${p.pop_change_ratio}%`,
    `周辺700mの施設 医療${counts["医療"] || 0}・入所${counts["入所"] || 0}・通所${counts["通所"] || 0}・訪問相談${counts["訪問・相談"] || 0}`,
  ].map((t) => `<span>${t}</span>`).join("");
}

// 区域の代表点から半径内にある施設。連携の「資源が近くにあるか」を見るために使う。
function facilitiesNear(feature, meters) {
  const [cx, cy] = centroid(feature.geometry);
  return state.facilities.features.filter((p) => {
    const [x, y] = p.geometry.coordinates;
    const dx = (x - cx) * 111320 * Math.cos((cy * Math.PI) / 180);
    const dy = (y - cy) * 110570;
    return Math.hypot(dx, dy) <= meters;
  });
}

function centroid(geom) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let cx = 0, cy = 0, total = 0;
  for (const poly of polys) {
    const ring = poly[0];
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      const cr = x1 * y2 - x2 * y1;
      a += cr; x += (x1 + x2) * cr; y += (y1 + y2) * cr;
    }
    a /= 2;
    if (!a) continue;
    cx += (x / (6 * a)) * Math.abs(a);
    cy += (y / (6 * a)) * Math.abs(a);
    total += Math.abs(a);
  }
  return total ? [cx / total, cy / total] : polys[0][0][0];
}

function fillRoles() {
  const opts = ROLES.map((r) => `<option>${r}</option>`).join("");
  $("my-role").innerHTML = opts;
  $("bot-role").innerHTML = opts;
  $("my-role").value = ROLES[0];
  $("bot-role").value = ROLES[1];
}

function restoreKey() {
  const k = localStorage.getItem("anthropic_key");
  if (k) $("apikey").value = k;
}

function reportVoiceSupport() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const parts = [];
  if (!SR) parts.push("この ブラウザは音声認識に対応していません（Chrome/Edge を推奨）。文字入力に切り替えてください。");
  if (!window.speechSynthesis) parts.push("音声合成に対応していないため、相手の発言は文字のみになります。");
  $("voice-support").textContent = parts.join(" ") || "音声はブラウザ内で処理されます（Chrome/Edge で動作確認）。";
}

function client() {
  const key = ($("apikey").value || "").trim();
  if (!key) throw new Error("APIキーを入れてください。");
  if (!state.client || state.client.apiKey !== key) {
    state.client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
  }
  return state.client;
}

function bindSetup() {
  $("save-key").onclick = () => {
    localStorage.setItem("anthropic_key", $("apikey").value.trim());
    $("save-key").textContent = "保存しました";
    setTimeout(() => ($("save-key").textContent = "保存"), 1600);
  };
  document.querySelectorAll('input[name="mode"]').forEach((r) => {
    r.onchange = () => { state.mode = document.querySelector('input[name="mode"]:checked').value; };
  });
  $("gen-scenario").onclick = generateScenario;
  $("start").onclick = startPlay;
}

/* ---------- 事例の自動生成 ---------- */

async function generateScenario() {
  const btn = $("gen-scenario");
  try {
    const c = client();
    btn.disabled = true;
    $("gen-status").textContent = "作成中…";
    const p = state.area.properties;
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 700,
      output_config: { effort: "low" },
      system:
        "あなたは日本の地域福祉に詳しい実務者です。研修用の事例を作ります。" +
        "実在の個人を想起させる固有名詞は使わず、支援上の要点だけを簡潔に書きます。",
      messages: [{
        role: "user",
        content:
          `沖縄県北谷町の「${p.label}」を舞台に、ソーシャルワーカーの多機関連携が論点になる事例の骨子を作ってください。\n\n` +
          `この区域の実際の統計（令和2年国勢調査）:\n${areaFactsText(state.area)}\n\n` +
          `登場する専門職: ${$("my-role").value} と ${$("bot-role").value}。\n\n` +
          "条件: 4〜6文。本人の状況、関わっている機関、連携がうまくいっていない points を含める。" +
          "統計の傾向（高齢化率や単身世帯率など）と噛み合う設定にする。前置きなしで骨子だけ書く。",
      }],
    });
    $("scenario").value = res.content.find((b) => b.type === "text")?.text.trim() || "";
    $("gen-status").textContent = "";
  } catch (e) {
    $("gen-status").textContent = errText(e);
  } finally {
    btn.disabled = false;
  }
}

function areaFactsText(f) {
  const p = f.properties;
  const near = facilitiesNear(f, 700);
  const kinds = {};
  for (const x of near) for (const k of x.properties.kinds) kinds[k] = (kinds[k] || 0) + 1;
  return [
    `- 人口 ${p.pop_2020}人（2015年比 ${p.pop_change_ratio}%）／世帯 ${p.households_2020}、平均 ${p.hh_avg_members}人`,
    `- 高齢化率 ${p.ratio_o65}%（2015年 ${p.ratio_o65_2015}%）、75歳以上 ${p.ratio_o75}%、15歳未満 ${p.ratio_u15}%`,
    `- 単身世帯 ${p.hh_single_ratio}%、高齢者のいる世帯 ${p.hh_with_o65_ratio}%、18歳未満のいる世帯 ${p.hh_with_u18_ratio}%`,
    `- 半径700m内の資源: ${Object.entries(kinds).map(([k, v]) => `${k}${v}`).join("、") || "なし"}`,
  ].join("\n");
}

/* ---------- ロールプレイ ---------- */

function startPlay() {
  try {
    client();
  } catch (e) {
    $("setup-error").textContent = e.message;
    $("setup-error").hidden = false;
    return;
  }
  if (!$("scenario").value.trim()) {
    $("setup-error").textContent = "事例の骨子を入れるか、生成してください。";
    $("setup-error").hidden = false;
    return;
  }
  $("setup-error").hidden = true;

  state.myRole = $("my-role").value;
  state.botRole = $("bot-role").value;
  state.scenario = $("scenario").value.trim();
  state.transcript = [];

  $("setup").hidden = true;
  $("play").hidden = false;
  $("debrief").hidden = true;
  $("play-meta").textContent =
    `${state.area.properties.label}／あなた=${state.myRole}／相手=${state.botRole}`;
  $("log").innerHTML = "";
  note(`舞台: ${state.area.properties.label}。あなたは${state.myRole}、相手は${state.botRole}です。声をかけてみてください。`);

  bindPlay();
  setupVoice();
}

function playSystem() {
  const p = state.area.properties;
  return [
    `あなたは「${state.botRole}」として、日本の対人援助実践のロールプレイに参加しています。`,
    `相手（ユーザー）は「${state.myRole}」です。`,
    "",
    "# 舞台",
    `沖縄県北谷町の「${p.label}」。この区域の実際の統計は次のとおりです。`,
    areaFactsText(state.area),
    "",
    "# 事例",
    state.scenario,
    "",
    "# 演じ方",
    `- ${state.botRole}として一人称で話してください。役を降りて解説しないこと。`,
    "- これは音声での会話です。1回の発話は2〜4文、話し言葉で。長い説明は避ける。",
    "- その職種が実際に持つ制度上の権限・持たない権限を守る。できないことは「できない」と言う。",
    "- 連携は理想化しない。所属組織の都合、書類、時間、判断のズレなど、現場で実際に起きる摩擦を自然に出す。",
    "- 相手に丸投げせず、しかし安請け合いもしない。必要なら情報を求め、確認し、時に異議を述べる。",
    "- 文献や理論の引用はしない。振り返りの時間に別途行います。",
    "- 応答は発話そのものだけを書く。ト書き、話者名、内部の思考、XMLタグなどは書かない。",
  ].join("\n");
}

function bindPlay() {
  $("send").onclick = () => submitText();
  $("say").onkeydown = (e) => { if (e.key === "Enter") submitText(); };
  $("end").onclick = runDebrief;
  $("back").onclick = () => { $("debrief").hidden = true; $("play").hidden = false; };
  $("copy-md").onclick = copyDebrief;

  const voice = state.mode === "voice";
  $("mic").style.display = voice ? "" : "none";
  $("say").focus();
}

function submitText() {
  const t = $("say").value.trim();
  if (!t) return;
  $("say").value = "";
  turn(t);
}

async function turn(text) {
  addTurn("me", state.myRole, text);
  state.transcript.push({ role: "me", text });

  const el = addTurn("bot", state.botRole, "");
  const body = el.querySelector(".what");
  $("play-status").textContent = "考えています…";

  const speaker = sentenceSpeaker();
  let full = "";

  try {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 600,
      // 音声の応答なので待たせない。思考は切り、深さは effort で抑える。
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: playSystem(),
      messages: state.transcript.map((t) => ({
        role: t.role === "me" ? "user" : "assistant",
        content: t.text,
      })),
    });

    stream.on("text", (chunk) => {
      full += chunk;
      body.textContent = full;
      $("log").scrollTop = $("log").scrollHeight;
      if (state.mode === "voice") speaker.push(chunk);
    });

    await stream.finalMessage();
    if (state.mode === "voice") speaker.flush();
    state.transcript.push({ role: "bot", text: full });
    $("play-status").textContent = "";
  } catch (e) {
    body.textContent = "";
    el.remove();
    note(`応答できませんでした: ${errText(e)}`);
    $("play-status").textContent = "";
  }
}

function addTurn(cls, who, what) {
  const el = document.createElement("div");
  el.className = `turn ${cls}`;
  el.innerHTML = `<div class="who">${who}</div><div class="what"></div>`;
  el.querySelector(".what").textContent = what;
  $("log").appendChild(el);
  $("log").scrollTop = $("log").scrollHeight;
  return el;
}

function note(text) {
  const el = document.createElement("div");
  el.className = "turn note";
  el.innerHTML = '<div class="what"></div>';
  el.querySelector(".what").textContent = text;
  $("log").appendChild(el);
  $("log").scrollTop = $("log").scrollHeight;
}

/* ---------- 音声 ---------- */

// 文が閉じた分だけ順に読み上げる。全文を待たないので会話のテンポが保てる。
function sentenceSpeaker() {
  let buf = "";
  const say = (s) => {
    const t = s.trim();
    if (!t || !window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = "ja-JP";
    u.rate = 1.05;
    const v = speechSynthesis.getVoices().find((x) => x.lang === "ja-JP");
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  };
  return {
    push(chunk) {
      buf += chunk;
      let m;
      while ((m = buf.match(/^[\s\S]*?[。！？!?]/))) {
        say(m[0]);
        buf = buf.slice(m[0].length);
      }
    },
    flush() { say(buf); buf = ""; },
  };
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("mic");
  if (!SR || state.mode !== "voice") { mic.style.display = "none"; return; }

  const rec = new SR();
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = true;

  let heard = "";
  let listening = false;

  const start = () => {
    if (listening) return;
    speechSynthesis?.cancel();   // 相手が話している最中でも割り込めるように
    heard = "";
    try { rec.start(); } catch { /* 連打対策: すでに起動中なら無視 */ }
    listening = true;
    mic.classList.add("on");
    $("mic-label").textContent = "聞いています…";
  };
  const stop = () => {
    if (!listening) return;
    rec.stop();
    listening = false;
    mic.classList.remove("on");
    $("mic-label").textContent = "押しながら話す";
    const said = heard.trim();
    if (said) turn(said);
  };

  rec.onresult = (e) => {
    heard = "";
    for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
    $("play-status").textContent = heard;
  };
  rec.onerror = (e) => {
    $("play-status").textContent = e.error === "not-allowed"
      ? "マイクの使用が許可されていません。ブラウザの設定を確認してください。"
      : `音声認識のエラー: ${e.error}`;
  };
  rec.onend = () => { listening = false; mic.classList.remove("on"); $("mic-label").textContent = "押しながら話す"; };

  mic.onpointerdown = (e) => { e.preventDefault(); start(); };
  mic.onpointerup = (e) => { e.preventDefault(); stop(); };
  mic.onpointerleave = () => stop();
}

/* ---------- 振り返り ---------- */

// 逐語に出てきた語で文献を絞る。埋め込みを使わず、手元で完結させる。
function pickWorks(text, limit = 10) {
  const kb = state.knowledge;
  if (!kb) return [];
  const terms = ["連携", "協働", "多職種", "多機関", "組織", "ジレンマ", "権限", "情報共有",
    "退院", "地域包括", "アウトリーチ", "支援", "専門職", "役割", "保健師", "ケアマネ",
    "生態", "エコロジカル", "信念対立", "スーパービジョン", "相談支援", "虐待", "認知症", "家族"];
  const hits = terms.filter((t) => text.includes(t));
  const scored = kb.works.map((w) => {
    const blob = w.title + " " + w.abstract + " " + w.highlights.map((h) => h.quote + h.note).join(" ");
    let score = 0;
    for (const t of hits) if (blob.includes(t)) score += 2;
    for (const t of terms) if (w.title.includes(t)) score += 1;
    score += Math.min(w.highlights.length, 10) * 0.3;   // 読み込んだ文献を優先する
    return { w, score };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.w);
}

function worksBlock(works) {
  return works.map((w) => {
    const au = w.authors.slice(0, 3).join("・") || "著者不明";
    const head = `## ${au}（${w.year || "n.d."}）「${w.title}」${w.source ? `『${w.source}』` : ""}`;
    const marks = w.highlights.slice(0, 8)
      .map((h) => `- ${h.page ? `p.${h.page} ` : ""}「${h.quote}」${h.note ? `（メモ: ${h.note}）` : ""}`)
      .join("\n");
    return [head, w.abstract ? `要旨: ${w.abstract.slice(0, 300)}` : "", marks].filter(Boolean).join("\n");
  }).join("\n\n");
}

async function runDebrief() {
  if (!state.transcript.length) { note("まだ会話がありません。"); return; }
  $("play").hidden = true;
  $("debrief").hidden = false;
  $("debrief-status").textContent = "整理しています…";

  const script = state.transcript
    .map((t) => `${t.role === "me" ? state.myRole : state.botRole}: ${t.text}`)
    .join("\n");
  const works = pickWorks(script);

  const system = [
    "あなたは社会福祉学の指導教員です。院生が行ったロールプレイの逐語を、",
    "**生態学的視点**（ミクロ／メゾ／エクソ／マクロの各システムと、その間の相互作用）で読み解きます。",
    "院生の修士論文のテーマは「ソーシャルワーカーの連携を生態学的に検討する」です。",
    "",
    "# 書き方",
    "- 見出しつきのMarkdown。前置きは書かない。",
    "- 逐語の具体的な発言を必ず引用して、そこから論じる。抽象論だけにしない。",
    "- 地域の統計は「マクロ／エクソの層に置かれた条件」として扱い、事例と結びつける。",
    "- 文献は与えられたものだけを使う。無いものを引かない。引用は 著者（年）の形式で、",
    "  該当のハイライトがあれば短く引き、ページがあれば添える。",
    "- 最後に「論文に向けた問い」を3つ、この逐語から実際に立てられるものだけ挙げる。",
    "",
    works.length ? `# 使える文献（院生自身のZoteroライブラリとハイライト）\n${worksBlock(works)}`
                 : "# 文献\n利用できる文献データがありません。文献の引用は行わず、逐語の分析に徹してください。",
  ].join("\n");

  const p = state.area.properties;
  const user = [
    `## 舞台\n沖縄県北谷町「${p.label}」\n${areaFactsText(state.area)}`,
    `## 事例\n${state.scenario}`,
    `## 役\n院生=${state.myRole}／相手役=${state.botRole}`,
    `## 逐語\n${script}`,
  ].join("\n\n");

  const body = $("debrief-body");
  body.innerHTML = "";
  let full = "";

  try {
    const stream = client().messages.stream({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "high" },
      system,
      messages: [{ role: "user", content: user }],
    });
    stream.on("text", (chunk) => {
      full += chunk;
      body.innerHTML = md(full);
    });
    await stream.finalMessage();
    state.lastDebrief = full;
    $("debrief-status").textContent = works.length ? `文献 ${works.length} 件を参照` : "";
  } catch (e) {
    $("debrief-status").textContent = errText(e);
  }
}

function copyDebrief() {
  if (!state.lastDebrief) return;
  navigator.clipboard.writeText(state.lastDebrief).then(() => {
    $("copy-md").textContent = "コピーしました";
    setTimeout(() => ($("copy-md").textContent = "Markdownでコピー"), 1600);
  });
}

/* ---------- 小物 ---------- */

// 振り返りの表示に足りるだけの最小Markdown。外部ライブラリを増やさない。
function md(src) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const lines = esc(src).split("\n");
  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList();
      const lvl = Math.min(m[1].length + 2, 5);
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList();
      out.push(`<blockquote>${inline(m[1])}</blockquote>`);
    } else if (!line) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function errText(e) {
  if (e?.status === 401) return "APIキーが正しくないようです。";
  if (e?.status === 429) return "レート制限にかかりました。少し待って再試行してください。";
  if (e?.status === 400) return `リクエストが拒否されました: ${e.message || ""}`;
  return e?.message || String(e);
}
