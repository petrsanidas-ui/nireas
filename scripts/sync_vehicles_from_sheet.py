#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from typing import Optional


def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return value.strip("_") or "unknown"


def normalize_header(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[\s\-]+", " ", value)
    return value


def map_status(value: str) -> str:
    raw = value.strip()
    if not raw:
        return "available"
    lowered = raw.lower().strip()
    mapping = {
        "in_service": "assigned",
        "in service": "assigned",
        "decommissioned": "unavailable",
        "reserved": "assigned",
        "out_of_service": "unavailable",
        "out of service": "unavailable",
        "awaiting_parts": "maintenance",
        "inspection_kteo": "maintenance",
        "available": "available",
        "unavailable": "unavailable",
    }
    return mapping.get(lowered, raw)


def fetch_csv(sheet_id: str, sheet_name: Optional[str], api_key: Optional[str]) -> str:
    if api_key:
        sheet_part = urllib.parse.quote(sheet_name) if sheet_name else "Sheet1"
        url = (
            f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"
            f"/values/{sheet_part}?key={api_key}"
        )
        with urllib.request.urlopen(url) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        values = data.get("values", [])
        output = []
        for row in values:
            output.append(",".join(
                '"' + str(cell).replace('"', '""') + '"' for cell in row
            ))
        return "\n".join(output)

    params = {"tqx": "out:csv"}
    if sheet_name:
        params["sheet"] = sheet_name
    url = (
        f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?"
        f"{urllib.parse.urlencode(params)}"
    )
    with urllib.request.urlopen(url) as resp:
        return resp.read().decode("utf-8")


def parse_rows(csv_text: str):
    reader = csv.reader(csv_text.splitlines())
    rows = list(reader)
    if not rows:
        return [], []
    headers = [normalize_header(h) for h in rows[0]]
    return headers, rows[1:]


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync vehicles.json from Google Sheets.")
    parser.add_argument("--sheet-id", required=True, help="Google Sheet ID.")
    parser.add_argument("--sheet-name", default=None, help="Sheet tab name.")
    parser.add_argument("--api-key", default=os.getenv("GOOGLE_SHEETS_API_KEY"))
    parser.add_argument(
        "--default-municipality-id",
        default=os.getenv("DEFAULT_MUNICIPALITY_ID", "").strip(),
        help="Fallback municipality_id when missing in the sheet.",
    )
    parser.add_argument(
        "--output",
        default="data/resources/vehicles.json",
        help="Output JSON path.",
    )
    args = parser.parse_args()

    csv_text = fetch_csv(args.sheet_id, args.sheet_name, args.api_key)
    headers, rows = parse_rows(csv_text)
    if not headers:
        print("No data found in sheet.", file=sys.stderr)
        return 1

    header_map = {
        "municipality_id": "municipality_id",
        "s/n": "serial",
        "registration number": "plate",
        "brand": "brand",
        "model": "model",
        "type": "type",
        "category": "category",
        "fuel": "fuel",
        "parking": "base",
        "department": "service",
        "license category": "license_category",
        "special category": "special_category",
        "status": "status",
    }

    vehicles = []
    counters: dict[str, int] = {}

    for row in rows:
        if not any(cell.strip() for cell in row):
            continue
        record: dict[str, str] = {}
        for idx, cell in enumerate(row):
            if idx >= len(headers):
                continue
            key = header_map.get(headers[idx])
            if not key:
                continue
            record[key] = cell.strip()

        municipality_id = record.get("municipality_id") or args.default_municipality_id
        if not municipality_id:
            continue

        counters.setdefault(municipality_id, 0)
        counters[municipality_id] += 1
        vehicle_id = f"veh_{slugify(municipality_id)}_{counters[municipality_id]:03d}"

        brand = record.get("brand", "").strip()
        model = record.get("model", "").strip()
        name_parts = [p for p in [brand, model] if p and p != "-"]
        name = " ".join(name_parts) if name_parts else ""
        if not name:
            name = record.get("type", "").strip()

        special_category = record.get("special_category", "").strip()

        vehicles.append(
            {
                "vehicle_id": vehicle_id,
                "name": name,
                "plate": record.get("plate", ""),
                "type": record.get("type", ""),
                "category": record.get("category", ""),
                "fuel": record.get("fuel", ""),
                "base": record.get("base", ""),
                "service": record.get("service", ""),
                "license_category": record.get("license_category", ""),
                "status": map_status(record.get("status", "")),
                "municipality_id": municipality_id,
                "brand": brand,
                "model": model,
                "notes": special_category,
            }
        )

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(vehicles, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"Wrote {len(vehicles)} vehicles to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
