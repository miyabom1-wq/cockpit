#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import re
import sys
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd
import requests
from bs4 import BeautifulSoup

PAGE_URL = "https://www.jpx.co.jp/listing/event-schedules/financial-announcement/"
OUTPUT = Path(__file__).resolve().parents[1] / "public" / "data" / "jpx_earnings.json"
UA = "Mozilla/5.0 (compatible; VANTAGE JPX Earnings Updater/1.0)"
JST = timezone(timedelta(hours=9))


def clean(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value))).strip()


def extract_links(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for anchor in soup.find_all("a", href=True):
        href = urljoin(PAGE_URL, anchor.get("href", "").strip())
        if not re.search(r"\.(?:xlsx?|csv)(?:$|[?#])", href, re.I):
            continue
        if href in seen:
            continue
        seen.add(href)
        parent_text = " ".join(anchor.parent.stripped_strings) if anchor.parent else ""
        found.append({"url": href, "label": parent_text[:240]})
    if found:
        return found
    for match in re.findall(r"""https?://[^"'<> ]+\.(?:xlsx?|csv)(?:\?[^"'<> ]*)?|/[^"'<> ]+\.(?:xlsx?|csv)(?:\?[^"'<> ]*)?""", html, re.I):
        href = urljoin(PAGE_URL, match)
        if href not in seen:
            seen.add(href)
            found.append({"url": href, "label": Path(urlparse(href).path).name})
    return found


def parse_code(value: object) -> str | None:
    text = clean(value).upper().replace(".0", "")
    if re.fullmatch(r"[0-9A-Z]{5}", text) and text.endswith("0"):
        text = text[:4]
    match = re.search(r"(?<![0-9A-Z])([0-9A-Z]{4})(?![0-9A-Z])", text)
    if not match:
        return None
    code = match.group(1)
    if not any(ch.isdigit() for ch in code):
        return None
    return code


def parse_date(value: object, today: date) -> date | None:
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not pd.isna(value) and 25000 <= float(value) <= 70000:
        return (datetime(1899, 12, 30) + timedelta(days=float(value))).date()

    text = clean(value)
    if not text or text in {"-", "―", "未定", "未確認"}:
        return None
    text = re.sub(r"[（(].*?[）)]", "", text)
    full = re.search(r"(20\d{2})[年/\-.](\d{1,2})[月/\-.](\d{1,2})日?", text)
    if full:
        try:
            return date(int(full.group(1)), int(full.group(2)), int(full.group(3)))
        except ValueError:
            return None
    short = re.search(r"(?<!\d)(\d{1,2})[月/.-](\d{1,2})日?(?!\d)", text)
    if short:
        month, day = int(short.group(1)), int(short.group(2))
        for year in (today.year, today.year + 1):
            try:
                candidate = date(year, month, day)
            except ValueError:
                continue
            if candidate >= today - timedelta(days=60):
                return candidate
    try:
        parsed = pd.to_datetime(text, errors="coerce")
        if not pd.isna(parsed):
            return parsed.date()
    except Exception:
        pass
    return None


def find_columns(frame: pd.DataFrame) -> tuple[int, int, int | None, int, int | None] | None:
    rows = min(len(frame), 45)
    cols = len(frame.columns)
    best = None
    best_score = -1
    for row_index in range(rows):
        merged = []
        for col in range(cols):
            pieces = [clean(frame.iat[r, col]) for r in range(max(0, row_index - 1), min(rows, row_index + 2))]
            merged.append("".join(x for x in pieces if x))
        code_cols = [i for i, text in enumerate(merged) if "コード" in text]
        date_cols = [
            i for i, text in enumerate(merged)
            if ("発表" in text and ("予定" in text or "日" in text)) or "開示予定日" in text
        ]
        if not code_cols or not date_cols:
            continue
        name_cols = [i for i, text in enumerate(merged) if "会社名" in text or "銘柄名" in text]
        period_cols = [i for i, text in enumerate(merged) if "決算種別" in text or "四半期" in text or "決算期" in text or "種別" in text]
        score = 10 + (3 if name_cols else 0) + (2 if period_cols else 0)
        if score > best_score:
            best_score = score
            best = (row_index, code_cols[0], name_cols[0] if name_cols else None, date_cols[0], period_cols[0] if period_cols else None)
    return best


def read_tables(content: bytes, url: str) -> list[tuple[str, pd.DataFrame]]:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix == ".csv":
        for encoding in ("utf-8-sig", "cp932", "shift_jis"):
            try:
                return [("csv", pd.read_csv(io.BytesIO(content), header=None, dtype=object, encoding=encoding))]
            except Exception:
                continue
        raise ValueError("CSV encoding could not be detected")
    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    book = pd.ExcelFile(io.BytesIO(content), engine=engine)
    return [(name, pd.read_excel(book, sheet_name=name, header=None, dtype=object)) for name in book.sheet_names]


def parse_file(content: bytes, source: dict[str, str], today: date) -> tuple[list[dict], list[str]]:
    events: list[dict] = []
    warnings: list[str] = []
    try:
        tables = read_tables(content, source["url"])
    except Exception as exc:
        return [], [f"{source['url']}: workbook open failed: {exc}"]

    for sheet_name, frame in tables:
        columns = find_columns(frame)
        if not columns:
            warnings.append(f"{Path(urlparse(source['url']).path).name}/{sheet_name}: header not detected")
            continue
        header_row, code_col, name_col, date_col, period_col = columns
        for row_index in range(header_row + 1, len(frame)):
            code = parse_code(frame.iat[row_index, code_col])
            if not code:
                continue
            event_date = parse_date(frame.iat[row_index, date_col], today)
            if not event_date:
                continue
            if event_date < today - timedelta(days=1) or event_date > today + timedelta(days=180):
                continue
            name = clean(frame.iat[row_index, name_col]) if name_col is not None else code
            period = clean(frame.iat[row_index, period_col]) if period_col is not None else ""
            iso_date = event_date.isoformat()
            events.append({
                "symbol": f"{code}.T",
                "code": code,
                "name": name or code,
                "date": iso_date,
                "time": f"{iso_date}T14:59:00.000Z",
                "period": period[:80],
                "source_name": "JPX 決算発表予定日",
                "source_url": source["url"],
                "source_label": source.get("label", "")[:240],
                "sheet": sheet_name,
            })
    return events, warnings


def main() -> int:
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "ja,en;q=0.8"})
    response = session.get(PAGE_URL, timeout=45)
    response.raise_for_status()
    links = extract_links(response.text)
    if not links:
        raise RuntimeError("No JPX Excel/CSV links were found")

    today = datetime.now(JST).date()
    all_events: list[dict] = []
    warnings: list[str] = []
    source_files: list[dict] = []

    for source in links:
        try:
            file_response = session.get(source["url"], timeout=60)
            file_response.raise_for_status()
            events, file_warnings = parse_file(file_response.content, source, today)
            all_events.extend(events)
            warnings.extend(file_warnings)
            source_files.append({
                "url": source["url"],
                "label": source.get("label", ""),
                "events": len(events),
                "bytes": len(file_response.content),
            })
        except Exception as exc:
            warnings.append(f"{source['url']}: download/parse failed: {exc}")

    by_symbol: dict[str, dict] = {}
    for event in sorted(all_events, key=lambda item: (item["date"], item["symbol"])):
        old = by_symbol.get(event["symbol"])
        if old is None or event["date"] < old["date"]:
            by_symbol[event["symbol"]] = event

    events = sorted(by_symbol.values(), key=lambda item: (item["date"], item["symbol"]))
    if not events:
        raise RuntimeError("JPX files were downloaded but no future earnings rows were parsed")

    payload = {
        "schema": "vantage-jpx-earnings-v1",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_page": PAGE_URL,
        "source_files": source_files,
        "events": events,
        "stats": {
            "links_found": len(links),
            "files_processed": len(source_files),
            "raw_rows": len(all_events),
            "unique_future_events": len(events),
            "warnings": warnings[:100],
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(OUTPUT)
    print(f"JPX earnings JSON updated: {len(events)} events from {len(source_files)} files")
    for warning in warnings[:20]:
        print(f"warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
