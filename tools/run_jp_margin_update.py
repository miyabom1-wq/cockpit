#!/usr/bin/env python3
"""GitHub Actions entrypoint for the JPX weekly margin updater.

JPX lists application dates as text and PDF files as icon-only links. The two
are not reliably connected by a shared HTML parent, so this entrypoint pairs
the ordered application dates with the ordered PDF links before delegating the
actual PDF parsing and validation to update_jp_margin.py.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

CORE_PATH = Path(__file__).with_name("update_jp_margin.py")
APPLICATION_RE = re.compile(
    r"(20\d{2})年\s*(\d{1,2})月\s*(\d{1,2})日\s*申込分"
)


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

    # The official page lists the weekly rows first and the notice PDFs after
    # them. Pair only the first N PDFs, where N is the number of application
    # dates, so schedule/change notices cannot be selected.
    candidates = [
        link_type(date=date, url=urljoin(page_url, href), label=label)
        for (date, label), href in zip(dates, pdf_links[: len(dates)])
    ]
    return max(candidates, key=lambda item: (item.date, item.url))


def self_test() -> None:
    html = """
    <div>2026年6月12日申込分 <a href="/weekly-1.pdf">PDF</a></div>
    <div>2026年7月3日申込分 <span><a href="/weekly-2.pdf"><img alt="PDF"></a></span></div>
    <div>2026年7月10日申込分</div><div><a href="/weekly-3.pdf"><img alt="PDF"></a></div>
    <div>変更日（2026年7月6日） <a href="/notice-1.pdf">PDF</a></div>
    <div>変更 <a href="/notice-2.pdf">PDF</a></div>
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
        self_test()
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
        print(
            f"JPX weekly PDF selected: {result.date} / {result.url}",
            file=sys.stderr,
        )
        return result

    core.discover_latest_pdf = discover_latest_pdf
    return int(core.main())


if __name__ == "__main__":
    raise SystemExit(main())
