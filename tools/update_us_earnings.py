#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

OUTPUT = Path(__file__).resolve().parents[1] / "public" / "data" / "us_earnings.json"
API_URL = "https://api.nasdaq.com/api/calendar/earnings"
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.nasdaq.com",
    "Referer": "https://www.nasdaq.com/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
}


def clean(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def payload_rows(payload: dict) -> list[dict]:
    data = payload.get("data") or {}
    for rows in (
        data.get("rows"),
        (data.get("calendar") or {}).get("rows"),
        (data.get("earnings") or {}).get("rows"),
    ):
        if isinstance(rows, list):
            return [row for row in rows if isinstance(row, dict)]
    return []


def timing(row: dict) -> str:
    text = " ".join(clean(row.get(k)) for k in ("time", "timeStatus", "reportTime", "marketTime")).lower()
    if "pre" in text or "before" in text:
        return "pre_market"
    if "after" in text or "post" in text:
        return "after_hours"
    return "unspecified"


def fetch_day(session: requests.Session, day: str) -> list[dict]:
    last = None
    for attempt in range(3):
        try:
            response = session.get(API_URL, params={"date": day}, timeout=30)
            response.raise_for_status()
            return payload_rows(response.json())
        except Exception as exc:
            last = exc
            time.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"{day}: {last}")


def main() -> int:
    today = datetime.now(timezone.utc).date()
    end = today + timedelta(days=120)
    session = requests.Session()
    session.headers.update(HEADERS)
    events = []
    failures = []
    requested = 0
    day = today

    while day <= end:
        if day.weekday() < 5:
            requested += 1
            try:
                for row in fetch_day(session, day.isoformat()):
                    symbol = clean(row.get("symbol")).upper()
                    if not re.fullmatch(r"[A-Z0-9.\-]{1,12}", symbol):
                        continue
                    events.append({
                        "symbol": symbol,
                        "name": clean(row.get("name") or row.get("companyName") or symbol),
                        "date": day.isoformat(),
                        "time": f"{day.isoformat()}T12:00:00.000Z",
                        "timing": timing(row),
                        "fiscal_quarter_ending": clean(row.get("fiscalQuarterEnding")),
                        "eps_forecast": clean(row.get("epsForecast")),
                        "market_cap": clean(row.get("marketCap")),
                    })
            except Exception as exc:
                failures.append(str(exc))
            time.sleep(0.08)
        day += timedelta(days=1)

    unique = {(e["date"], e["symbol"]): e for e in events}
    result = sorted(unique.values(), key=lambda x: (x["date"], x["symbol"]))
    if not result:
        raise RuntimeError("Nasdaq calendar returned no usable earnings events")

    payload = {
        "schema": "vantage-us-earnings-v1",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source_page": "https://www.nasdaq.com/market-activity/earnings",
        "source_api": API_URL,
        "source_note": "Nasdaq calendar; expected dates supplied by Zacks and subject to change.",
        "events": result,
        "stats": {
            "requested_weekdays": requested,
            "events": len(result),
            "failed_dates": len(failures),
            "failures": failures[:30],
        },
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temp = OUTPUT.with_suffix(".json.tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(OUTPUT)
    print(f"US earnings JSON updated: {len(result)} events; failures={len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
