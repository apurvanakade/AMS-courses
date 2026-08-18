#!/usr/bin/env python3
"""
Refresh the current and next academic term's course data, then rebuild the
database and graph.json. Intended to be run on a schedule (see
.github/workflows/refresh-courses.yml) but also safe to run by hand:

    python3 scripts/refresh_terms.py

Only re-fetches the current + next term (not the full historical data/
folder) since those are the only terms whose sections, instructors, seat
counts, or syllabus links realistically change over time.

Term boundary is a simple calendar-month heuristic (Jan-Jun -> Spring is
current, Jul-Dec -> Fall is current) via fetch_courses.current_term() /
next_term() — the same functions fetch_courses.py itself uses to default
its interactive prompt, kept as the one source of truth so this script and
a bare `fetch_courses.py` run never disagree on what "current" means. JHU's
actual registration windows don't align exactly to calendar-year halves,
but since this runs weekly the heuristic self-corrects over time.

`data/*/courses.json` and `courses.csv` are gitignored (see .gitignore) so
the current/next term's daily-changing files don't add a commit's worth of
git history every single run. Once a term ages out of the current/next
window — this script no longer refetches it — `archive_stale_terms()`
below force-adds its files on the first run after the transition, giving
it exactly one permanent commit that locks in its final state as the
historical record described in CLAUDE.md. Older terms that are already
archived this way are untouched (force-adding an unchanged file is a
no-op).
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fetch_courses import current_term as get_current_term  # noqa: E402
from fetch_courses import next_term as get_next_term  # noqa: E402
from fetch_courses import term_to_folder  # noqa: E402


def archive_stale_terms(current_term: str, next_term: str) -> None:
    """Force-add any data/ term folder that is no longer current or next."""
    active_folders = {term_to_folder(current_term), term_to_folder(next_term)}
    data_dir = REPO_ROOT / "data"
    for folder in sorted(data_dir.iterdir()):
        if not folder.is_dir():
            continue
        if str(folder.relative_to(REPO_ROOT)) in active_folders:
            continue
        for name in ("courses.json", "courses.csv"):
            path = folder / name
            if path.exists():
                subprocess.run(["git", "add", "-f", str(path)], cwd=REPO_ROOT, check=True)


def main() -> int:
    current_term = get_current_term()
    next_term = get_next_term(current_term)
    print(f'Refreshing "{current_term}" and "{next_term}"...')

    for term in (current_term, next_term):
        subprocess.run(
            [sys.executable, "fetch_courses.py", "--term", term, "--yes"],
            cwd=REPO_ROOT,
            check=True,
        )

    subprocess.run([sys.executable, "build_database.py"], cwd=REPO_ROOT, check=True)
    archive_stale_terms(current_term, next_term)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
