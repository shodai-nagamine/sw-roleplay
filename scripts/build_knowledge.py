"""ローカルのZotero DBから、連携研究の知識ベースを組み立てる。

出力:
  docs/data/knowledge.json    書誌＋要旨＋自分のハイライト（**git管理外**）
  docs/data/bibliography.json 書誌だけ（事実情報なので公開可）

ハイライトは論文原文の抜粋なので、公開リポジトリには置かない。
知識ベースはローカルで起動したときだけ読み込まれる。
"""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
ZOTERO = Path.home() / "Zotero" / "zotero.sqlite"

# 修士論文「ソーシャルワーカーの連携を生態学的に検討する」に効く語
TOPIC = [
    "連携", "協働", "多職種", "多機関", "ソーシャルワーク", "ソーシャルワーカー",
    "生態", "エコロジカル", "地域包括", "チーム", "IPW", "IPE", "組織",
    "相談支援", "支援", "専門職", "保健師", "ケアマネ", "退院",
]


def connect() -> sqlite3.Connection:
    if not ZOTERO.exists():
        raise SystemExit(f"Zotero DB が見つからない: {ZOTERO}")
    # Zotero 起動中でも読めるよう読み取り専用・immutable で開く
    con = sqlite3.connect(f"file:{ZOTERO}?mode=ro&immutable=1", uri=True)
    con.row_factory = sqlite3.Row
    return con


def fetch_fields(con) -> dict[int, dict[str, str]]:
    rows = con.execute("""
        select d.itemID, f.fieldName, v.value
        from itemData d
        join fields f on f.fieldID = d.fieldID
        join itemDataValues v on v.valueID = d.valueID
    """)
    out: dict[int, dict[str, str]] = {}
    for r in rows:
        out.setdefault(r["itemID"], {})[r["fieldName"]] = r["value"]
    return out


def fetch_creators(con) -> dict[int, list[str]]:
    rows = con.execute("""
        select ic.itemID, c.lastName, c.firstName
        from itemCreators ic
        join creators c on c.creatorID = ic.creatorID
        order by ic.itemID, ic.orderIndex
    """)
    out: dict[int, list[str]] = {}
    for r in rows:
        name = (r["lastName"] or "") + (r["firstName"] or "")
        if name:
            out.setdefault(r["itemID"], []).append(name)
    return out


def fetch_annotations(con) -> dict[int, list[dict]]:
    """PDF添付の子アノテーションを、親アイテムIDに束ね直す。"""
    rows = con.execute("""
        select att.parentItemID as item, a.type, a.text, a.comment, a.pageLabel, a.sortIndex
        from itemAnnotations a
        join itemAttachments att on att.itemID = a.parentItemID
        where att.parentItemID is not null
        order by att.parentItemID, a.sortIndex
    """)
    out: dict[int, list[dict]] = {}
    for r in rows:
        text = (r["text"] or "").strip()
        comment = (r["comment"] or "").strip()
        if not text and not comment:
            continue
        out.setdefault(r["item"], []).append({
            "quote": re.sub(r"\s+", " ", text),
            "note": re.sub(r"\s+", " ", comment),
            "page": r["pageLabel"] or "",
        })
    return out


def year_of(date: str) -> str:
    m = re.search(r"(\d{4})", date or "")
    return m.group(1) if m else ""


def main() -> None:
    con = connect()
    fields = fetch_fields(con)
    creators = fetch_creators(con)
    annos = fetch_annotations(con)

    # 添付ファイル・ノートは除き、書誌アイテムだけを対象にする
    top = {
        r["itemID"]
        for r in con.execute("""
            select i.itemID from items i
            where i.itemID not in (select itemID from itemAttachments)
              and i.itemID not in (select itemID from itemNotes)
              and i.itemID not in (select itemID from itemAnnotations)
        """)
    }

    works = []
    for item_id in top:
        f = fields.get(item_id, {})
        title = (f.get("title") or "").strip()
        if not title or title.lower().endswith(".pdf"):
            continue
        marks = annos.get(item_id, [])
        blob = title + " " + (f.get("abstractNote") or "")
        relevant = any(t in blob for t in TOPIC)
        if not relevant and not marks:
            continue

        works.append({
            "id": f.get("citationKey") or str(item_id),
            "title": title,
            "authors": creators.get(item_id, []),
            "year": year_of(f.get("date", "")),
            "source": f.get("publicationTitle", ""),
            "doi": f.get("DOI", ""),
            "url": f.get("url", ""),
            "abstract": re.sub(r"\s+", " ", (f.get("abstractNote") or "")).strip(),
            "highlights": marks,
        })

    # ハイライトが多い＝読み込んだ文献を上に
    works.sort(key=lambda w: (-len(w["highlights"]), w["year"]), reverse=False)
    works.sort(key=lambda w: -len(w["highlights"]))

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "knowledge.json").write_text(
        json.dumps({"works": works}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    # 公開可能な書誌のみ（ハイライト・要旨は落とす）
    (OUT / "bibliography.json").write_text(
        json.dumps(
            {"works": [{k: w[k] for k in ("id", "title", "authors", "year", "source", "doi", "url")}
                       for w in works]},
            ensure_ascii=False, indent=1,
        ),
        encoding="utf-8",
    )

    marked = [w for w in works if w["highlights"]]
    print(f"文献 {len(works)} 件 / うちハイライトあり {len(marked)} 件 "
          f"（ハイライト計 {sum(len(w['highlights']) for w in works)} 箇所）")
    for w in marked[:8]:
        au = "・".join(w["authors"][:2]) or "著者不明"
        print(f"  {len(w['highlights']):>3}箇所  {au} ({w['year']}) {w['title'][:52]}")


if __name__ == "__main__":
    main()
