#!/usr/bin/env python3
"""Build public/data/jp-margin.json from official JPX public pages.

The updater deliberately runs outside the Worker because the all-issue weekly file is
an ~80 page PDF.  It validates the extracted universe before replacing the previous
JSON, so a layout change at JPX cannot silently publish an empty/corrupted dataset.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

JST = timezone(timedelta(hours=9))
WEEKLY_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/margin/05.html"
DAILY_PAGE = "https://www.jpx.co.jp/markets/equities/margin-daily/index.html"
SPECIAL_PAGE = "https://www.jpx.co.jp/markets/equities/margin-daily/01.html"
RESTRICTION_PAGE = "https://www.jpx.co.jp/markets/equities/margin-reg/index.html"
SCHEMA = "jp-margin-v1"
UA = "Mozilla/5.0 (compatible; VANTAGE-JP-Margin/1.0; +https://miyabom1-wq.github.io/cockpit/)"
DATE_RE = re.compile(r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日|(?:20\d{2})[/-]\d{1,2}[/-]\d{1,2}")
CODE_RE = re.compile(r"^(?:\d{4,5}|\d{3}[A-Z](?:0)?)$")
NUM_RE = re.compile(r"^[▲△△-]?\(?[▲△-]?[\d,]+(?:\.\d+)?\)?$")


@dataclass
class LinkWithDate:
    date: str
    url: str
    label: str


def get(url: str, *, binary: bool = False) -> bytes | str:
    r = requests.get(url, headers={"User-Agent": UA, "Accept": "*/*"}, timeout=60)
    r.raise_for_status()
    return r.content if binary else r.text


def iso_date(text: str) -> Optional[str]:
    m = DATE_RE.search(text or "")
    if not m:
        return None
    if m.group(1):
        y, mo, d = map(int, m.groups()[:3])
    else:
        y, mo, d = map(int, re.findall(r"\d+", m.group(0)))
    return f"{y:04d}-{mo:02d}-{d:02d}"


def discover_latest_pdf(page_url: str = WEEKLY_PAGE) -> LinkWithDate:
    soup = BeautifulSoup(get(page_url), "html.parser")
    found: list[LinkWithDate] = []
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if ".pdf" not in href.lower():
            continue
        context = " ".join([
            a.get_text(" ", strip=True),
            a.parent.get_text(" ", strip=True) if a.parent else "",
            a.find_previous(string=DATE_RE) or "",
        ])
        d = iso_date(context)
        if d:
            found.append(LinkWithDate(d, urljoin(page_url, href), context.strip()))
    if not found:
        raise RuntimeError("JPX週次ページから日付付きPDFリンクを検出できませんでした")
    return max(found, key=lambda x: (x.date, x.url))


def parse_number(v: str) -> Optional[float]:
    s = str(v or "").strip().replace(" ", "").replace(",", "")
    if not s or s in {"-", "—", "―"}:
        return None
    neg = "▲" in s or "△" in s or (s.startswith("(") and s.endswith(")")) or s.startswith("-")
    s = s.replace("▲", "").replace("△", "").replace("(", "").replace(")", "").replace("+", "")
    try:
        n = float(s)
        return -n if neg else n
    except ValueError:
        return None


def normalize_code(token: str) -> Optional[str]:
    s = re.sub(r"[^0-9A-Z]", "", str(token or "").upper())
    if len(s) == 5 and s.endswith("0") and (s[:4].isdigit() or re.fullmatch(r"\d{3}[A-Z]", s[:4])):
        s = s[:4]
    if re.fullmatch(r"\d{4}|\d{3}[A-Z]", s):
        return f"{s}.T"
    return None


def choose_totals(nums: list[float]) -> Optional[tuple[int, int, int, int]]:
    """Return sell balance/change and buy balance/change.

    JPX's weekly PDF contains totals plus general/standardized subcolumns.  Across
    historical layouts the numeric group is either 4 (totals only), 6/8, or 12
    values (total/general/standardized, each balance and weekly change).
    """
    if len(nums) >= 12:
        return int(nums[0]), int(nums[1]), int(nums[6]), int(nums[7])
    if len(nums) >= 8:
        return int(nums[0]), int(nums[1]), int(nums[4]), int(nums[5])
    if len(nums) >= 6:
        return int(nums[0]), int(nums[1]), int(nums[3]), int(nums[4])
    if len(nums) >= 4:
        return int(nums[0]), int(nums[1]), int(nums[2]), int(nums[3])
    return None


def row_record(cells: Iterable[object]) -> Optional[dict]:
    vals = [re.sub(r"\s+", " ", str(x or "")).strip() for x in cells]
    code_idx = next((i for i, x in enumerate(vals) if CODE_RE.fullmatch(x.replace(" ", ""))), None)
    if code_idx is None:
        return None
    symbol = normalize_code(vals[code_idx])
    if not symbol:
        return None
    name_tokens: list[str] = []
    number_values: list[float] = []
    started_numbers = False
    for x in vals[code_idx + 1 :]:
        compact = x.replace(" ", "")
        n = parse_number(compact) if NUM_RE.fullmatch(compact) else None
        if n is not None:
            started_numbers = True
            number_values.append(n)
        elif not started_numbers and x and not re.search(r"市場|Market|区分|銘柄", x, re.I):
            name_tokens.append(x)
    totals = choose_totals(number_values)
    if not totals:
        return None
    sell, sell_chg, buy, buy_chg = totals
    if min(sell, buy) < 0 or max(sell, buy) > 10**11:
        return None
    return {"symbol": symbol, "name": " ".join(name_tokens).strip() or symbol, "sell_balance": sell, "sell_change": sell_chg, "buy_balance": buy, "buy_change": buy_chg}


def parse_tables(pdf: pdfplumber.PDF) -> dict[str, dict]:
    records: dict[str, dict] = {}
    settings = [
        {},
        {"vertical_strategy": "text", "horizontal_strategy": "text", "snap_tolerance": 3, "intersection_tolerance": 5},
    ]
    for page in pdf.pages:
        for st in settings:
            try:
                tables = page.extract_tables(st) or []
            except Exception:
                continue
            for table in tables:
                for row in table or []:
                    rec = row_record(row or [])
                    if rec:
                        records[rec["symbol"]] = rec
        if len(records) > 3600:
            break
    return records


def parse_text(pdf: pdfplumber.PDF) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for page in pdf.pages:
        text = page.extract_text(x_tolerance=1.2, y_tolerance=2.5) or ""
        lines = [re.sub(r"\s+", " ", x).strip() for x in text.splitlines() if x.strip()]
        buffer: list[str] = []
        segments: list[list[str]] = []
        for line in lines:
            tokens = line.split()
            positions = [i for i, t in enumerate(tokens) if CODE_RE.fullmatch(t)]
            if positions:
                for pos in positions:
                    if buffer:
                        segments.append(buffer)
                    buffer = tokens[pos:]
            elif buffer:
                buffer.extend(tokens)
        if buffer:
            segments.append(buffer)
        for seg in segments:
            rec = row_record(seg)
            if rec:
                records[rec["symbol"]] = rec
    return records


def parse_weekly_pdf(pdf_bytes: bytes) -> dict[str, dict]:
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        table_records = parse_tables(pdf)
        if len(table_records) >= 1000:
            return table_records
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        text_records = parse_text(pdf)
    if len(text_records) > len(table_records):
        return text_records
    return table_records


def active_table(page_url: str, heading_pattern: str) -> list[dict]:
    soup = BeautifulSoup(get(page_url), "html.parser")
    heading = next((h for h in soup.find_all(["h2", "h3"]) if re.search(heading_pattern, h.get_text(" ", strip=True))), None)
    table = heading.find_next("table") if heading else soup.find("table")
    out: list[dict] = []
    if not table:
        return out
    headers = [th.get_text(" ", strip=True) for th in table.find_all("th")]
    for tr in table.find_all("tr"):
        cells = [x.get_text(" ", strip=True) for x in tr.find_all(["td", "th"])]
        raw_code = next((c for c in cells if normalize_code(c)), None)
        symbol = normalize_code(raw_code) if raw_code else None
        if not symbol:
            continue
        code = symbol.removesuffix(".T")
        name = cells[0].lstrip("※◆* ") if cells else code
        date = next((iso_date(c) for c in cells if iso_date(c)), None)
        detail = cells[3] if len(cells) >= 4 else ""
        out.append({"symbol": symbol, "name": name, "date": date, "detail": detail, "headers": headers})
    return out


def pct_from_change(balance: int, change: int) -> Optional[float]:
    prior = balance - change
    return round(change / abs(prior) * 100, 2) if prior else None


def build_dataset(records: dict[str, dict], link: LinkWithDate, previous: dict, min_count: int) -> dict:
    if len(records) < min_count:
        raise RuntimeError(f"PDF抽出件数が少なすぎます: {len(records)}件（最低{min_count}件）")
    daily = {x["symbol"]: x for x in active_table(DAILY_PAGE, r"^日々公表銘柄$")}
    special = {x["symbol"]: x for x in active_table(SPECIAL_PAGE, r"特別周知銘柄")}
    restricted = {x["symbol"]: x for x in active_table(RESTRICTION_PAGE, r"信用取引に関する規制を行っている銘柄")}
    prev_items = previous.get("items", {}) if isinstance(previous, dict) else {}
    generated = datetime.now(JST).isoformat(timespec="seconds")
    items: dict[str, dict] = {}
    for symbol, r in records.items():
        old_hist = list(prev_items.get(symbol, {}).get("history", []))
        snapshot = {"as_of": link.date, "sell_balance": r["sell_balance"], "sell_change": r["sell_change"], "buy_balance": r["buy_balance"], "buy_change": r["buy_change"]}
        old_hist = [x for x in old_hist if x.get("as_of") != link.date]
        old_hist.append(snapshot)
        old_hist = sorted(old_hist, key=lambda x: x.get("as_of", ""))[-8:]
        four_back = old_hist[-5] if len(old_hist) >= 5 else None
        buy_4w = r["buy_balance"] - int(four_back["buy_balance"]) if four_back else None
        buy_4w_pct = round(buy_4w / abs(int(four_back["buy_balance"])) * 100, 2) if four_back and int(four_back["buy_balance"]) else None
        sell = r["sell_balance"]
        ratio = round(r["buy_balance"] / sell, 4) if sell else None
        flags = {
            "daily_disclosure": symbol in daily,
            "daily_disclosure_since": daily.get(symbol, {}).get("date"),
            "special_notice": symbol in special,
            "special_notice_since": special.get(symbol, {}).get("date"),
            "margin_restriction": symbol in restricted,
            "margin_restriction_since": restricted.get(symbol, {}).get("date"),
            "restriction_detail": restricted.get(symbol, {}).get("detail") or None,
        }
        items[symbol] = {
            "symbol": symbol,
            "name": r["name"],
            "weekly": {
                "as_of": link.date,
                "published_at": generated,
                "source_url": link.url,
                "sell_balance": r["sell_balance"],
                "sell_change": r["sell_change"],
                "sell_change_pct": pct_from_change(r["sell_balance"], r["sell_change"]),
                "buy_balance": r["buy_balance"],
                "buy_change": r["buy_change"],
                "buy_change_pct": pct_from_change(r["buy_balance"], r["buy_change"]),
                "ratio": ratio,
                "buy_4w_change": buy_4w,
                "buy_4w_change_pct": buy_4w_pct,
            },
            "flags": flags,
            "history": old_hist,
        }
    # Preserve active flags even for a rare symbol absent from the weekly PDF.
    for source in (daily, special, restricted):
        for symbol, x in source.items():
            if symbol in items:
                continue
            flags = {
                "daily_disclosure": symbol in daily,
                "daily_disclosure_since": daily.get(symbol, {}).get("date"),
                "special_notice": symbol in special,
                "special_notice_since": special.get(symbol, {}).get("date"),
                "margin_restriction": symbol in restricted,
                "margin_restriction_since": restricted.get(symbol, {}).get("date"),
                "restriction_detail": restricted.get(symbol, {}).get("detail") or None,
            }
            items[symbol] = {"symbol": symbol, "name": x.get("name") or symbol, "weekly": None, "flags": flags, "history": []}
    return {
        "schema": SCHEMA,
        "generated_at": generated,
        "weekly": {"as_of": link.date, "published_at": generated, "source_url": link.url, "count": len(records), "status": "official-jpx-weekly"},
        "rules": {"updated_at": generated, "daily_disclosure_source": DAILY_PAGE, "special_notice_source": SPECIAL_PAGE, "margin_restriction_source": RESTRICTION_PAGE, "daily_disclosure_count": len(daily), "special_notice_count": len(special), "margin_restriction_count": len(restricted)},
        "source": {"publisher": "Japan Exchange Group / Tokyo Stock Exchange", "weekly_page": WEEKLY_PAGE, "note": "週次残高と日次の注意・規制区分。価格・出来高はVANTAGE側で統合。"},
        "items": items,
    }


def self_test() -> None:
    assert normalize_code("72030") == "7203.T"
    assert normalize_code("285A0") == "285A.T"
    assert normalize_code("472A") == "472A.T"
    assert choose_totals([10, -2, 20, 3]) == (10, -2, 20, 3)
    assert choose_totals([10, -2, 3, 1, 7, -3, 20, 4, 8, 1, 12, 3]) == (10, -2, 20, 4)
    rec = row_record(["72030", "トヨタ自動車", "1,000", "▲100", "2,000", "300"])
    assert rec and rec["sell_balance"] == 1000 and rec["buy_change"] == 300
    print("JP margin updater self-test passed")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="public/data/jp-margin.json")
    ap.add_argument("--min-count", type=int, default=1000)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--pdf", help="Use a local PDF fixture instead of downloading")
    ap.add_argument("--as-of", help="As-of date for --pdf")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    out = Path(args.output)
    previous = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    if args.pdf:
        link = LinkWithDate(args.as_of or datetime.now(JST).date().isoformat(), Path(args.pdf).resolve().as_uri(), "local fixture")
        pdf_bytes = Path(args.pdf).read_bytes()
    else:
        link = discover_latest_pdf()
        pdf_bytes = get(link.url, binary=True)
    records = parse_weekly_pdf(pdf_bytes)
    data = build_dataset(records, link, previous, args.min_count)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    tmp.replace(out)
    print(f"Updated {out}: {data['weekly']['as_of']} / {data['weekly']['count']} issues / flags {data['rules']['daily_disclosure_count']} daily, {data['rules']['margin_restriction_count']} restricted")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
