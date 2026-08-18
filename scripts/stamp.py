"""資産のURLに内容ハッシュを打つ。

ブラウザは ES モジュールを強く握るので、中身を変えても古いままになることがある。
（実際、OpenAI へ切り替えた後も旧版が動き続け、中継の旧パスを叩いて404になった）
参照側の URL に ?v=<内容ハッシュ> を付けて、変わったときだけ別URLにする。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

# 「この参照を書き換える」対象。(書き換えるファイル, 参照先の実体, URLの書き方)
REFS = [
    (DOCS / "index.html",            DOCS / "assets/app.js",        "assets/app.js"),
    (DOCS / "index.html",            DOCS / "assets/style.css",     "assets/style.css"),
    (DOCS / "assets/app.js",         DOCS / "assets/avatar-view.js", "./avatar-view.js"),
    (DOCS / "assets/avatar-view.js", DOCS / "lib/avatar.js",        "../lib/avatar.js"),
    (DOCS / "assets/avatar-view.js", DOCS / "lib/three.module.js",  "../lib/three.module.js"),
    (DOCS / "lib/avatar.js",         DOCS / "lib/three.module.js",  "./three.module.js"),
]


def short_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:8]


def main() -> None:
    # 参照される側から先に確定させないと、親のハッシュが古い子を指したままになる
    changed = []
    for _ in range(len(REFS)):          # 依存の深さ分だけ回せば安定する
        for holder, target, url in REFS:
            if not holder.exists() or not target.exists():
                continue
            h = short_hash(target)
            src = holder.read_text(encoding="utf-8")
            new = re.sub(
                rf"{re.escape(url)}(\?v=[0-9a-f]+)?",
                f"{url}?v={h}",
                src,
            )
            if new != src:
                holder.write_text(new, encoding="utf-8")
                changed.append(f"{holder.name} → {url}?v={h}")

    if changed:
        for c in dict.fromkeys(changed):
            print("  ", c)
    else:
        print("   変更なし")


if __name__ == "__main__":
    main()
