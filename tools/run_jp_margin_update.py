#!/usr/bin/env python3
"""GitHub Actions entrypoint for JPX weekly margin data.

The official JPX PDF is a fixed-column landscape table. Generic table/text
extraction can shift columns and create plausible-looking but invalid symbols.
This entrypoint therefore reads each data row by PDF coordinates, validates all
12 numeric columns, and delegates dataset assembly to update_jp_margin.py.
"""
from __future__ import annotations

import importlib.util
import io
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from urllib.parse import urljoin

import pdfplumber
import requests
from bs4 import BeautifulSoup

CORE_PATH = Path(__file__).with_name("update_jp_margin.py")
APPLICATION_RE = re.compile(r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日\s*申込分")
TYPE_MARKERS = frozenset("ABJKMCTF")
SYMBOL_RE = re.compile(r"(?:\d{4}|\d{3}[A-Z])\.T")
ISIN_RE = re.compile(r"[A-Z]{2}[A-Z0-9]{10}")
CODE5_RE = re.compile(r"(?:\d{4}|\d{3}[A-Z])0")
SPECIAL5_RE = re.compile(r"\d{5}")
NUMBER_BOUNDS = tuple((287.5 + 45.0 * i, 287.5 + 45.0 * (i + 1)) for i in range(12))
PARSER_NAME = "pdfplumber-coordinate-columns-v2"


def load_core():
    spec = importlib.util.spec_from_file_location("vantage_jp_margin_core", CORE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"更新本体を読み込めません: {CORE_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def discover_pdf_from_html(html: bytes | str, page_url: str, link_type):
    soup = BeautifulSoup(html, "html.parser")
    page_text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))

    dates: list[tuple[str, str]] = []
    for match in APPLICATION_RE.finditer(page_text):
        year, month, day = map(int, match.groups())
        date = f"{year:04d}-{month:02d}-{day:02d}"
        if not dates or dates[-1][0] != date:
            dates.append((date, match.group(0)))

    pdf_links: list[str] = []
    for anchor in soup.select("a[href]"):
        href = str(anchor.get("href", "")).strip()
        if ".pdf" in href.lower():
            pdf_links.append(href)

    if not dates:
        raise RuntimeError(
            f"JPX週次ページから申込日を検出できませんでした (PDFリンク {len(pdf_links)}件)"
        )
    if len(pdf_links) < len(dates):
        raise RuntimeError(
            "JPX週次ページのPDFリンク数が不足しています "
            f"(申込日 {len(dates)}件 / PDFリンク {len(pdf_links)}件)"
        )

    candidates = [
        link_type(date=date, url=urljoin(page_url, href), label=label)
        for (date, label), href in zip(dates, pdf_links[: len(dates)])
    ]
    return max(candidates, key=lambda item: (item.date, item.url))


def _row_chars(page: Any, row_top: float, x0: float, x1: float, tolerance: float, *, center: bool = False) -> list[dict]:
    out: list[dict] = []
    for char in page.chars:
        if abs(float(char["top"]) - row_top) > tolerance:
            continue
        x = (float(char["x0"]) + float(char["x1"])) / 2.0 if center else float(char["x0"])
        if x0 <= x < x1:
            out.append(char)
    out.sort(key=lambda char: (float(char["x0"]), float(char["top"])))
    return out


def _chars_text(chars: list[dict]) -> str:
    return "".join(str(char.get("text", "")) for char in chars)


def _number_from_chars(chars: list[dict]) -> int | None:
    raw = _chars_text(chars).replace(" ", "").replace(",", "")
    if not raw:
        return None
    if raw in {"-", "−", "－", "—", "―"}:
        return 0
    negative = "▲" in raw or "△" in raw or raw.startswith(("-", "−", "－"))
    digits = re.sub(r"[^0-9]", "", raw)
    if not digits:
        return None
    value = int(digits)
    return -value if negative else value


def _code_from_chars(chars: list[dict]) -> tuple[str | None, str]:
    ascii_text = "".join(
        str(char.get("text", ""))
        for char in chars
        if re.fullmatch(r"[0-9A-Z]", str(char.get("text", "")))
    )
    matches = list(CODE5_RE.finditer(ascii_text))
    if matches:
        code5 = matches[-1].group(0)
        return f"{code5[:4]}.T", code5
    special = SPECIAL5_RE.search(ascii_text)
    return None, special.group(0) if special else ascii_text


def _isin_from_chars(chars: list[dict]) -> str | None:
    ascii_text = "".join(
        str(char.get("text", ""))
        for char in chars
        if re.fullmatch(r"[0-9A-Z]", str(char.get("text", "")))
    )
    match = ISIN_RE.search(ascii_text)
    return match.group(0) if match else None


def _clean_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", raw).strip()
    name = re.sub(r"(?:普通株式|投資証券|受益証券)\s*$", "", name).strip()
    return name


def _quality_failure(records: dict[str, dict], diag: dict) -> str | None:
    if diag["observed_rows"] < 4000:
        return f"行数不足: {diag['observed_rows']}"
    if diag["rejected_rows"]:
        return f"列整合性エラー: {diag['rejected_rows']}行"
    if len(records) < 4000:
        return f"標準銘柄コード抽出不足: {len(records)}"
    if diag["accepted_ratio"] < 0.98:
        return f"正常抽出率不足: {diag['accepted_ratio']:.4f}"
    if "0000.T" in records:
        return "禁止コード 0000.T を検出"
    if any(not SYMBOL_RE.fullmatch(symbol) or symbol.startswith("0") for symbol in records):
        return "不正な銘柄コードを検出"
    anchors = {
        "1301.T": "極洋",
        "7203.T": "トヨタ",
        "9432.T": "ＮＴＴ",
    }
    for symbol, expected_name in anchors.items():
        item = records.get(symbol)
        if not item or expected_name not in item.get("name", ""):
            return f"既知銘柄検証失敗: {symbol}"
    return None


def parse_weekly_pdf_by_coordinates(pdf_bytes: bytes) -> tuple[dict[str, dict], dict]:
    records: dict[str, dict] = {}
    skipped_special: list[dict] = []
    rejected: list[dict] = []
    observed_rows = 0

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            markers = [
                char
                for char in page.chars
                if str(char.get("text", "")) in TYPE_MARKERS
                and 20.0 <= float(char["x0"]) <= 35.0
                and float(char["top"]) >= 95.0
            ]
            row_tops: list[float] = []
            for marker in sorted(markers, key=lambda char: float(char["top"])):
                top = float(marker["top"])
                if not row_tops or abs(top - row_tops[-1]) > 0.5:
                    row_tops.append(top)

            for row_top in row_tops:
                observed_rows += 1
                name = _clean_name(_chars_text(_row_chars(page, row_top, 35.0, 218.0, 1.6)))
                symbol, raw_code = _code_from_chars(_row_chars(page, row_top, 218.0, 241.0, 1.6))
                isin = _isin_from_chars(_row_chars(page, row_top, 241.0, 292.0, 1.6))
                numbers = [
                    _number_from_chars(_row_chars(page, row_top, left, right, 0.8, center=True))
                    for left, right in NUMBER_BOUNDS
                ]

                if symbol is None:
                    skipped_special.append({"page": page_number, "code": raw_code, "name": name})
                    continue

                reason: str | None = None
                if not isin:
                    reason = "ISIN"
                elif any(value is None for value in numbers):
                    reason = "numeric-column"
                else:
                    values = [int(value) for value in numbers if value is not None]
                    sums_ok = (
                        values[0] == values[4] + values[6]
                        and values[1] == values[5] + values[7]
                        and values[2] == values[8] + values[10]
                        and values[3] == values[9] + values[11]
                    )
                    if not sums_ok:
                        reason = "column-sum"
                    elif values[0] < 0 or values[2] < 0:
                        reason = "negative-balance"

                if reason:
                    rejected.append(
                        {
                            "page": page_number,
                            "symbol": symbol,
                            "code": raw_code,
                            "name": name,
                            "isin": isin,
                            "reason": reason,
                            "numbers": numbers,
                        }
                    )
                    continue

                values = [int(value) for value in numbers if value is not None]
                records[symbol] = {
                    "symbol": symbol,
                    "name": name or symbol,
                    "isin": isin,
                    "sell_balance": values[0],
                    "sell_change": values[1],
                    "buy_balance": values[2],
                    "buy_change": values[3],
                }

        accepted_ratio = len(records) / observed_rows if observed_rows else 0.0
        diag = {
            "parser": PARSER_NAME,
            "pages": len(pdf.pages),
            "observed_rows": observed_rows,
            "accepted_rows": len(records),
            "accepted_ratio": round(accepted_ratio, 6),
            "skipped_nonstandard_codes": len(skipped_special),
            "skipped_examples": skipped_special[:10],
            "rejected_rows": len(rejected),
            "rejected_examples": rejected[:10],
            "anchors": {
                symbol: {
                    "name": records.get(symbol, {}).get("name"),
                    "sell_balance": records.get(symbol, {}).get("sell_balance"),
                    "buy_balance": records.get(symbol, {}).get("buy_balance"),
                }
                for symbol in ("1301.T", "285A.T", "7203.T", "9432.T")
            },
        }

    failure = _quality_failure(records, diag)
    diag["quality_status"] = "failed" if failure else "passed"
    diag["quality_error"] = failure
    print("Coordinate parser diagnostics: " + json.dumps(diag, ensure_ascii=False), file=sys.stderr)

    # Returning no records makes core.main save the diagnostics/source PDF first,
    # then fail its minimum-count gate instead of publishing suspect data.
    return ({}, diag) if failure else (records, diag)


def previous_dataset_is_trustworthy(previous: dict) -> bool:
    items = previous.get("items") if isinstance(previous, dict) else None
    if not isinstance(items, dict) or len(items) < 4000:
        return False
    if "0000.T" in items:
        return False
    checks = {"1301.T": "極洋", "7203.T": "トヨタ", "9432.T": "ＮＴＴ"}
    for symbol, expected in checks.items():
        item = items.get(symbol)
        if not isinstance(item, dict) or expected not in str(item.get("name", "")):
            return False
        weekly = item.get("weekly")
        if not isinstance(weekly, dict) or int(weekly.get("sell_balance", -1)) < 0 or int(weekly.get("buy_balance", -1)) < 0:
            return False
    return True


def entrypoint_self_test() -> None:
    html = """
    <div>2026年6月12日申込分 <a href="/weekly-1.pdf">PDF</a></div>
    <div>2026年7月3日申込分 <span><a href="/weekly-2.pdf"><img alt="PDF"></a></span></div>
    <div>2026年7月10日申込分</div><div><a href="/weekly-3.pdf"><img alt="PDF"></a></div>
    <div>変更日（2026年7月15日） <a href="/notice-1.pdf">PDF</a></div>
    """
    result = discover_pdf_from_html(
        html.encode("utf-8"),
        "https://www.jpx.co.jp/markets/statistics-equities/margin/05.html",
        SimpleNamespace,
    )
    assert result.date == "2026-07-10"
    assert result.url.endswith("/weekly-3.pdf")
    print("JP margin workflow entrypoint self-test passed")


def main() -> int:
    if "--entrypoint-self-test" in sys.argv:
        entrypoint_self_test()
        return 0

    core = load_core()

    def discover_latest_pdf(page_url: str = core.WEEKLY_PAGE):
        response = requests.get(
            page_url,
            headers={"User-Agent": core.UA, "Accept": "text/html,*/*"},
            timeout=60,
        )
        response.raise_for_status()
        result = discover_pdf_from_html(response.content, page_url, core.LinkWithDate)
        print(f"JPX weekly PDF selected: {result.date} / {result.url}", file=sys.stderr)
        return result

    original_build_dataset = core.build_dataset

    def build_dataset_with_validation(records, link, previous, min_count):
        if not previous_dataset_is_trustworthy(previous):
            print("Previous JP margin JSON failed quality checks; history was reset.", file=sys.stderr)
            previous = {}
        data = original_build_dataset(records, link, previous, min_count)
        data.setdefault("source", {})["parser"] = PARSER_NAME
        data["validation"] = {
            "status": "passed",
            "parser": PARSER_NAME,
            "standard_symbol_count": len(records),
            "history_reset": not previous_dataset_is_trustworthy(previous),
        }
        return data

    core.discover_latest_pdf = discover_latest_pdf
    core.parse_weekly_pdf = parse_weekly_pdf_by_coordinates
    core.build_dataset = build_dataset_with_validation
    return int(core.main())


if __name__ == "__main__":
    raise SystemExit(main())
