#!/usr/bin/env python3
"""Build public/data/jp-margin.json from official JPX public pages.

The updater deliberately runs outside the Worker because the all-issue weekly file is
an ~80 page PDF. It validates the extracted universe before replacing the previous
JSON, so a JPX layout change cannot silently publish an empty/corrupted dataset.
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

# Third-party packages are required only for the real JPX download/parser run.
# Keep imports optional so --self-test works on a clean Windows Python install.
try:
    import requests  # type: ignore
except ImportError:
    requests = None
try:
    import pdfplumber  # type: ignore
except ImportError:
    pdfplumber = None
try:
    from bs4 import BeautifulSoup  # type: ignore
except ImportError:
    BeautifulSoup = None
try:
    import fitz  # type: ignore  # Optional PyMuPDF fallback
except ImportError:
    fitz = None

JST = timezone(timedelta(hours=9))
WEEKLY_PAGE = "https://www.jpx.co.jp/markets/statistics-equities/margin/05.html"
DAILY_PAGE = "https://www.jpx.co.jp/markets/equities/margin-daily/index.html"
SPECIAL_PAGE = "https://www.jpx.co.jp/markets/equities/margin-daily/01.html"
RESTRICTION_PAGE = "https://www.jpx.co.jp/markets/equities/margin-reg/index.html"
SCHEMA = "jp-margin-v1"
UA = "Mozilla/5.0 (compatible; VANTAGE-JP-Margin/1.1; +https://miyabom1-wq.github.io/cockpit/)"
DATE_RE = re.compile(r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日|(?:20\d{2})[/-]\d{1,2}[/-]\d{1,2}")
CODE_CORE_RE = re.compile(r"(?:\d{4}|\d{3}[A-Z])", re.I)
NUM_FIND_RE = re.compile(r"(?:▲|△|[-−－])?\s*\(?\s*[\d,]+(?:\.\d+)?\s*\)?")
TEXT_RE = re.compile(r"[A-Za-zぁ-んァ-ヶ一-龠々]", re.I)


@dataclass
class LinkWithDate:
    date: str
    url: str
    label: str


def require_runtime_dependencies() -> None:
    missing = []
    if requests is None:
        missing.append("requests")
    if pdfplumber is None:
        missing.append("pdfplumber")
    if BeautifulSoup is None:
        missing.append("beautifulsoup4")
    if missing:
        raise RuntimeError("実データ更新に必要なPythonパッケージがありません: " + ", ".join(missing))


def get(url: str, *, binary: bool = False) -> bytes | str:
    if requests is None:
        raise RuntimeError("requests がありません")
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


def href_date(href: str) -> Optional[str]:
    """Extract YYYY-MM-DD from a dated JPX PDF filename when present."""
    text = str(href or "")
    m = re.search(r"(?<!\d)(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)(?!\d)", text)
    if not m:
        return None
    y, mo, d = map(int, m.groups())
    try:
        return datetime(y, mo, d).date().isoformat()
    except ValueError:
        return None


def _compact_text(node: object, limit: int = 1200) -> str:
    try:
        text = node.get_text(" ", strip=True)  # type: ignore[attr-defined]
    except Exception:
        text = str(node or "")
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit]


def nearby_link_contexts(a: object) -> list[str]:
    """Return nearest text blocks first for icon-only JPX PDF links."""
    out: list[str] = []

    def add(value: object) -> None:
        text = _compact_text(value)
        if text and text not in out:
            out.append(text)

    add(a)
    try:
        for attr in ("title", "aria-label"):
            value = a.get(attr)  # type: ignore[attr-defined]
            if value:
                add(value)
        img = a.find("img")  # type: ignore[attr-defined]
        if img:
            add(img.get("alt", ""))
    except Exception:
        pass

    node = a
    for _ in range(7):
        node = getattr(node, "parent", None)
        if node is None:
            break
        add(node)
        current = out[-1] if out else ""
        if ("申込" in current or "application" in current.lower()) and iso_date(current):
            break

    try:
        node = a
        for _ in range(10):
            node = node.find_previous()  # type: ignore[attr-defined]
            if node is None:
                break
            add(node)
    except Exception:
        pass
    return out


def discover_pdf_from_html(html: str, page_url: str = WEEKLY_PAGE) -> LinkWithDate:
    soup = BeautifulSoup(html, "html.parser")
    found: list[LinkWithDate] = []
    fallback: list[LinkWithDate] = []
    pdf_count = 0
    for a in soup.select("a[href]"):
        href = str(a.get("href", ""))
        if ".pdf" not in href.lower():
            continue
        pdf_count += 1
        contexts = nearby_link_contexts(a)
        selected_context = ""
        selected_date: Optional[str] = None
        for context in contexts:
            date = iso_date(context)
            if not date:
                continue
            lower = context.lower()
            if "申込" in context or "application" in lower:
                selected_context, selected_date = context, date
                break
        if selected_date:
            found.append(LinkWithDate(selected_date, urljoin(page_url, href), selected_context))
            continue

        date = href_date(href)
        combined = " ".join(contexts[:5])
        if date and not re.search(r"変更|スケジュール|schedule|change|notice", combined, re.I):
            fallback.append(LinkWithDate(date, urljoin(page_url, href), combined.strip() or href))

    candidates = found or fallback
    if not candidates:
        raise RuntimeError(
            "JPX週次ページから申込日付きPDFリンクを検出できませんでした "
            f"(PDFリンク {pdf_count}件)"
        )
    return max(candidates, key=lambda x: (x.date, x.url))


def discover_latest_pdf(page_url: str = WEEKLY_PAGE) -> LinkWithDate:
    return discover_pdf_from_html(str(get(page_url)), page_url)


def parse_number(v: str) -> Optional[float]:
    s = str(v or "").strip().replace(" ", "").replace(",", "")
    if not s or s in {"-", "−", "－", "—", "―"}:
        return None
    neg = any(x in s for x in ("▲", "△")) or (s.startswith("(") and s.endswith(")")) or s.startswith(("-", "−", "－"))
    for mark in ("▲", "△", "(", ")", "+", "-", "−", "－"):
        s = s.replace(mark, "")
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


def code_at(vals: list[str]) -> Optional[tuple[int, int, str]]:
    """Return (start index, number of cells consumed, symbol).

    JPX PDFs may emit the fifth market digit as a separate word (7203 0),
    insert a hyphen (7203-0), or place a line break inside the code cell.
    """
    for i, raw in enumerate(vals[:10]):
        if i + 1 < len(vals):
            joined = f"{raw}{vals[i + 1]}"
            symbol = normalize_code(joined)
            compact_next = re.sub(r"\s+", "", vals[i + 1])
            if symbol and compact_next in {"0", "０"}:
                return i, 2, symbol
        direct = normalize_code(raw)
        if direct:
            return i, 1, direct
        m = CODE_CORE_RE.search(str(raw).upper())
        if m:
            tail = str(raw)[m.start():]
            symbol = normalize_code(tail)
            if symbol:
                return i, 1, symbol
    return None


def numeric_fragments(value: str) -> list[float]:
    s = str(value or "").strip()
    if not s:
        return []
    matches = list(NUM_FIND_RE.finditer(s))
    if not matches:
        return []
    residue = NUM_FIND_RE.sub("", s)
    # Numeric cells may include separators/newlines, but not company/market text.
    if TEXT_RE.search(residue):
        return []
    out: list[float] = []
    for m in matches:
        n = parse_number(m.group(0))
        if n is not None:
            out.append(n)
    return out


def choose_totals(nums: list[float]) -> Optional[tuple[int, int, int, int]]:
    """Return sell balance/change and buy balance/change."""
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
    found = code_at(vals)
    if not found:
        return None
    code_idx, consumed, symbol = found
    name_tokens: list[str] = []
    number_values: list[float] = []
    started_numbers = False
    for x in vals[code_idx + consumed:]:
        nums = numeric_fragments(x)
        if nums:
            started_numbers = True
            number_values.extend(nums)
        elif not started_numbers and x and not re.search(r"市場|Market|区分|銘柄|コード", x, re.I):
            name_tokens.append(x)
    totals = choose_totals(number_values)
    if not totals:
        return None
    sell, sell_chg, buy, buy_chg = totals
    if min(sell, buy) < 0 or max(sell, buy) > 10**11:
        return None
    return {
        "symbol": symbol,
        "name": " ".join(name_tokens).strip() or symbol,
        "sell_balance": sell,
        "sell_change": sell_chg,
        "buy_balance": buy,
        "buy_change": buy_chg,
    }


def add_rows(records: dict[str, dict], rows: list[list[str]]) -> None:
    for i, row in enumerate(rows):
        candidates = [row]
        if i + 1 < len(rows):
            candidates.append(row + rows[i + 1])
        for candidate in candidates:
            rec = row_record(candidate)
            if rec:
                records[rec["symbol"]] = rec
                break


def group_words(words: list[dict], tolerance: float = 3.0) -> list[list[str]]:
    ordered = sorted(words, key=lambda w: (float(w.get("top", 0)), float(w.get("x0", 0))))
    groups: list[dict] = []
    for word in ordered:
        top = float(word.get("top", 0))
        if not groups or abs(top - groups[-1]["top"]) > tolerance:
            groups.append({"top": top, "words": [word]})
        else:
            groups[-1]["words"].append(word)
            groups[-1]["top"] = (groups[-1]["top"] + top) / 2
    return [[str(w.get("text", "")) for w in sorted(g["words"], key=lambda x: float(x.get("x0", 0)))] for g in groups]


def parse_tables(pdf: pdfplumber.PDF) -> dict[str, dict]:
    records: dict[str, dict] = {}
    settings = [
        {},
        {"vertical_strategy": "text", "horizontal_strategy": "text", "snap_tolerance": 3, "intersection_tolerance": 5},
        {"vertical_strategy": "lines", "horizontal_strategy": "lines", "snap_tolerance": 4, "join_tolerance": 4},
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
    return records


def parse_pdfplumber_words(pdf: pdfplumber.PDF) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for page in pdf.pages:
        try:
            words = page.extract_words(x_tolerance=2, y_tolerance=3, keep_blank_chars=False) or []
        except Exception:
            words = []
        add_rows(records, group_words(words))
    return records


def parse_pdfplumber_text(pdf: pdfplumber.PDF) -> dict[str, dict]:
    records: dict[str, dict] = {}
    for page in pdf.pages:
        text = page.extract_text(x_tolerance=2, y_tolerance=3, layout=True) or page.extract_text() or ""
        rows = [re.split(r"\s+", line.strip()) for line in text.splitlines() if line.strip()]
        add_rows(records, rows)
    return records


def parse_pymupdf(pdf_bytes: bytes) -> dict[str, dict]:
    records: dict[str, dict] = {}
    if fitz is None:
        return records
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        for page in doc:
            rows: list[list[str]] = []
            # block_no and line_no preserve visual rows more reliably than plain text.
            words = page.get_text("words", sort=True) or []
            grouped: dict[tuple[int, int], list[tuple]] = {}
            for w in words:
                grouped.setdefault((int(w[5]), int(w[6])), []).append(w)
            for key in sorted(grouped, key=lambda k: (min(x[1] for x in grouped[k]), min(x[0] for x in grouped[k]))):
                rows.append([str(x[4]) for x in sorted(grouped[key], key=lambda z: z[0])])
            add_rows(records, rows)
    finally:
        doc.close()
    return records


def pdf_diagnostics(pdf_bytes: bytes) -> dict:
    out = {"bytes": len(pdf_bytes), "pdfplumber_pages": 0, "first_page_chars": 0, "first_page_words": 0, "pymupdf_pages": 0, "pymupdf_first_page_chars": 0}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            out["pdfplumber_pages"] = len(pdf.pages)
            if pdf.pages:
                out["first_page_chars"] = len(pdf.pages[0].extract_text() or "")
                out["first_page_words"] = len(pdf.pages[0].extract_words() or [])
    except Exception as exc:
        out["pdfplumber_error"] = str(exc)
    try:
        if fitz is None:
            out["pymupdf_status"] = "not-installed"
            return out
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        out["pymupdf_pages"] = len(doc)
        if len(doc):
            out["pymupdf_first_page_chars"] = len(doc[0].get_text("text") or "")
        doc.close()
    except Exception as exc:
        out["pymupdf_error"] = str(exc)
    return out


def parse_weekly_pdf(pdf_bytes: bytes) -> tuple[dict[str, dict], dict]:
    methods: dict[str, dict[str, dict]] = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        methods["pdfplumber_tables"] = parse_tables(pdf)
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        methods["pdfplumber_words"] = parse_pdfplumber_words(pdf)
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        methods["pdfplumber_text"] = parse_pdfplumber_text(pdf)
    methods["pymupdf_words"] = parse_pymupdf(pdf_bytes)
    counts = {name: len(rows) for name, rows in methods.items()}
    best_name, records = max(methods.items(), key=lambda item: len(item[1]))
    diag = {**pdf_diagnostics(pdf_bytes), "method_counts": counts, "selected_method": best_name, "selected_count": len(records)}
    print("Parser diagnostics: " + json.dumps(diag, ensure_ascii=False), file=sys.stderr)
    return records, diag


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
    assert code_at(["7203", "0", "トヨタ"]) == (0, 2, "7203.T")
    assert code_at(["7203-0", "トヨタ"])[2] == "7203.T"
    assert choose_totals([10, -2, 20, 3]) == (10, -2, 20, 3)
    assert choose_totals([10, -2, 3, 1, 7, -3, 20, 4, 8, 1, 12, 3]) == (10, -2, 20, 4)
    rec = row_record(["72030", "トヨタ自動車", "1,000", "▲100", "2,000", "300"])
    assert rec and rec["sell_balance"] == 1000 and rec["buy_change"] == 300
    rec2 = row_record(["7203", "0", "トヨタ自動車", "1,000 ▲100", "2,000 300"])
    assert rec2 and rec2["symbol"] == "7203.T" and rec2["buy_balance"] == 2000
    if BeautifulSoup is not None:
        html = """
        <table>
          <tr><td>2026年7月3日申込分</td><td><span><a href="/files/week_20260703.pdf"><img alt="PDF"></a></span></td></tr>
          <tr><td>2026年7月10日申込分</td><td><span><a href="/files/week_20260710.pdf"><img alt="PDF"></a></span></td></tr>
        </table>
        <p>信用取引残高の公表情報の変更について（2026年7月15日） <a href="/files/notice_20260715.pdf">PDF</a></p>
        """
        link = discover_pdf_from_html(html, WEEKLY_PAGE)
        assert link.date == "2026-07-10" and link.url.endswith("week_20260710.pdf")
    assert href_date("/files/week_20260710.pdf") == "2026-07-10"
    print("JP margin updater self-test passed")


def write_diagnostics(directory: Optional[str], *, link: LinkWithDate, pdf_bytes: bytes, diag: Optional[dict] = None) -> None:
    if not directory:
        return
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    (root / "source.pdf").write_bytes(pdf_bytes)
    payload = {"link": {"date": link.date, "url": link.url, "label": link.label}, "parser": diag or {}}
    (root / "diagnostics.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="public/data/jp-margin.json")
    ap.add_argument("--min-count", type=int, default=1000)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--pdf", help="Use a local PDF fixture instead of downloading")
    ap.add_argument("--as-of", help="As-of date for --pdf")
    ap.add_argument("--diagnostics-dir", help="Save source PDF and parser counts for failed Actions")
    args = ap.parse_args()
    if args.self_test:
        self_test()
        return 0
    require_runtime_dependencies()
    out = Path(args.output)
    previous = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    if args.pdf:
        link = LinkWithDate(args.as_of or datetime.now(JST).date().isoformat(), Path(args.pdf).resolve().as_uri(), "local fixture")
        pdf_bytes = Path(args.pdf).read_bytes()
    else:
        link = discover_latest_pdf()
        pdf_bytes = get(link.url, binary=True)
    records, diag = parse_weekly_pdf(pdf_bytes)
    write_diagnostics(args.diagnostics_dir, link=link, pdf_bytes=pdf_bytes, diag=diag)
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
