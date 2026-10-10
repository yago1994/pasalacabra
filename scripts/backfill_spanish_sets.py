"""Restore past Spanish daily sets from git history into dated files.

Until the generator wrote one file per day, every daily set overwrote
src/data/sets/set_01.json, so the only copy of older games is in the history
of that file. This walks that history and writes each version to
daily/es/YYYY-MM-DD.json, using the date in the set's title
("Pasalacabra 2026-09-20 · No. 263") — the day it was played, which is not
always the day it was committed.

Safe to re-run: existing files are left alone unless --force is passed.

    python3 scripts/backfill_spanish_sets.py              # history of origin/main
    python3 scripts/backfill_spanish_sets.py --ref HEAD
"""

import argparse
import json
import os
import re
import subprocess

LEGACY_PATH = "src/data/sets/set_01.json"
DEFAULT_SETS_DIR = os.getenv("SETS_DIR", "daily/es")
TITLE_DATE = re.compile(r"^Pasalacabra (\d{4}-\d{2}-\d{2})\b")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--ref", default="origin/main", help="branch or commit whose history to read")
    parser.add_argument("--out", default=DEFAULT_SETS_DIR, help="directory for the dated files")
    parser.add_argument("--force", action="store_true", help="overwrite files that already exist")
    args = parser.parse_args()

    # Oldest first, so if a day was ever committed twice the later fix wins.
    commits = git("log", "--reverse", "--format=%H", args.ref, "--", LEGACY_PATH).split()
    by_date: dict = {}
    skipped = 0
    for commit in commits:
        try:
            obj = json.loads(git("show", f"{commit}:{LEGACY_PATH}"))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            skipped += 1
            continue
        match = TITLE_DATE.match(obj.get("title") or "")
        if not match:
            # The hand-written prototype sets from before the daily game.
            skipped += 1
            continue
        by_date[match.group(1)] = obj

    os.makedirs(args.out, exist_ok=True)
    written = kept = 0
    for day, obj in sorted(by_date.items()):
        path = os.path.join(args.out, f"{day}.json")
        if os.path.exists(path) and not args.force:
            kept += 1
            continue
        obj["id"] = f"es-{day}"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write("\n")
        written += 1

    days = sorted(by_date)
    span = f"{days[0]} → {days[-1]}" if days else "none"
    print(f"{len(commits)} versions of {LEGACY_PATH} on {args.ref}: {len(by_date)} dated sets ({span}).")
    print(f"Wrote {written}, kept {kept} existing, skipped {skipped} without a dated title.")


if __name__ == "__main__":
    main()
