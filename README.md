# sw-roleplay — 連携ロールプレイ

修士論文「ソーシャルワーカーの連携を生態学的に検討する」の思考を進めるための、
**ブラウザで動く音声ロールプレイ相手**。

北谷町の実際の字（あざ）を舞台に、Botが相手役の専門職を演じる。
終えると、逐語を生態学的視点（ミクロ／メゾ／エクソ／マクロ）で整理し、
手元のZoteroライブラリの文献とハイライトに照らして論点を出す。

## 動かし方

**公開版**: https://shodai-nagamine.github.io/sw-roleplay/
Chrome か Edge で開き、**合言葉**を入れる。APIキーは要らない（`worker/` の中継が持っている）。
自分の OpenAI APIキーを入れた場合はそちらが優先され、上限なく使える。
ただし公開版は**文献の引用ができない**（下記「公開版とローカル版の違い」）。

**ローカル版**（文献つき・こちらが本番）:

```bash
python3 scripts/build_knowledge.py   # Zotero → docs/data/knowledge.json（初回のみ）
python3 -m http.server 8943 --directory docs
```

Claude Code なら preview の `sw-roleplay` で立つ。

**Chrome か Edge を使うこと。** 音声認識（Web Speech API）が Safari/Firefox では動かない。
音声が使えない環境では「文字で打つ」に切り替えれば全機能そのまま使える。

## 構成

| | |
|---|---|
| 頭脳 | OpenAI Chat Completions。既定はロールプレイ `gpt-4.1-mini`／振り返り `gpt-4.1`（画面で変更可）。公式SDKを esm.sh から読み込むのでビルド不要 |
| 音声 | Web Speech API（認識・合成ともブラウザ内で完結。外部サービスに音声を送らない） |
| 舞台 | 北谷町の28区域。国勢調査の人口・高齢化率・世帯構成と、半径700m内の医療/介護施設数 |
| 文献 | ローカルZoteroから104件・ハイライト227箇所。逐語の語で絞ってから振り返りに渡す |

ロールプレイは待たせないよう軽いモデル・短い `max_completion_tokens`、
振り返りは強いモデル・長めで回している。ストリーミングで届いた分から読み上げる。

## 公開版とローカル版の違い

| | 公開版(GitHub Pages) | ローカル版 |
|---|---|---|
| ロールプレイ | 動く | 動く |
| 振り返り（生態学的視点の整理） | 動く | 動く |
| 文献の引用 | **できない** | Zotero 104件・ハイライト227箇所を参照 |

`docs/data/knowledge.json` は **gitignore 済み**。中身はZoteroのハイライト、つまり
論文原文の抜粋なので、公開リポジトリに置くと再配布になる。そのため公開版では
振り返りが「文献の引用なし」で動き、起動時に注意書きが出る。

書誌情報だけの `bibliography.json`（タイトル・著者・年・DOI）も **gitignore 済み**。
事実情報なので公開しても法的な問題は無いが、修論の読書リストそのものなので出さないことにした。
`build_knowledge.py` を実行すればローカルには生成される。

## 既知の制約

- **課金は中継のキーの持ち主に来る。** 上限は `worker/wrangler.toml` の
  `DAILY_OUTPUT_TOKENS`（既定 60,000）と `DAILY_REQUESTS_PER_IP`（既定 30）で決まる。
  上限に達した日は 429 を返して止まる。増やすなら値を変えて `npx wrangler deploy`。
- 生態学的視点の枠組み（ミクロ／メゾ／エクソ／マクロ）はプロンプトに直書きしている。
  論文で別の枠組みを採るなら `playSystem()` と `runDebrief()` の system を書き換える。
- 事例の自動生成は統計と噛み合う設定を作らせているが、**実在の事例ではない**。

## インタビューモード

**情報提供者を先に固定するのが要点。** 「この役と字から人物を作らせる」で、経験年数・職歴・
所属の体制・担当範囲・連携についての考え（癖のあるものを一つ）・話し方を作る。
その人物像は聞き取りの間ずっとシステムプロンプトに入り続けるので、途中で経歴が変わらない。

相手の答え方はロールプレイと変えてある。

- 聞かれたことに答える。**自分から話題を広げたり質問を返したりしない**（聞き手の練習にならないため）
- 抽象論ではなく、時期・相手の職種・何が起きたかを含む具体的な場面として語る
- 一度話した経歴・数字・エピソードを後から変えない
- 分からないことは「覚えていない」と言う。作り足さない
- 立場上言いにくいことは言い淀む。掘り下げられたら応じる

**質問ガイド**（1行1項目）を入れておくと、振り返りで「聞けた／部分的／聞けていない」を判定する。

### 逐語を kotonoha に渡す

「逐語をCSVで保存」で、[kotonoha](https://github.com/shodai-nagamine/kotonoha) がそのまま読める
CSVを書き出す（BOM付きUTF-8なのでExcelでも文字化けしない）。

| 列 | 役割 |
|---|---|
| `発言` | テキスト列。ここを分析する |
| `話者` `通番` `やり方` `舞台の字` `相手の役` `こちらの立場` | 外部変数。話者別・場面別の比較に使う |

```bash
cd ~/dev/apps/kotonoha
uv run kotonoha new iv.ktn --from ~/Downloads/interview_字宮城_2026-08-18.csv --text-col 発言
uv run kotonoha preprocess iv.ktn
uv run kotonoha freq iv.ktn --top 50
uv run kotonoha kwic iv.ktn 連携
```

## 中継（worker/）

合言葉だけで使えるのは、Cloudflare Worker が APIキーを預かって中継しているため。
ブラウザにキーは来ない。

```
docs/（GitHub Pages・localhost） ──合言葉──▶ sw-roleplay-relay（Worker） ──APIキー──▶ api.openai.com
```

守っていること:

- **設定が欠けたら開かない**。`ANTHROPIC_API_KEY` / `ACCESS_CODE` / KV のどれかが未設定なら
  上流に投げずに 500 で止まる（設定漏れで開いた中継になるのを防ぐ）
- **合言葉が要る**。長さも内容も早期 return しない比較で照合する
- **CORS は Pages と localhost:8943 のみ**。他所のページから叩けない
- **中継するのは `POST /v1/chat/completions` だけ**。他のパス・メソッドは 404
- **モデルと `max_tokens` を絞る**（`ALLOWED_MODELS` / `MAX_TOKENS_CAP`）
- **使った出力トークンを数えて日次予算から引く**。ストリームを tee して素通ししつつ集計するので、
  会話は止めずに上限が効く

運用:

```bash
cd worker
npx wrangler secret put OPENAI_API_KEY      # 上流のキー（課金はこの持ち主に来る）
npx wrangler secret put ACCESS_CODE         # 配る合言葉
npx wrangler deploy
npx wrangler tail                           # 動いている様子を見る
```

合言葉を変えたいときは `secret put ACCESS_CODE` をやり直すだけでよい（再デプロイ不要）。
