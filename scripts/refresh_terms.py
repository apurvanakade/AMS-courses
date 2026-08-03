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
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fetch_courses import current_term as get_current_term  # noqa: E402
from fetch_courses import next_term as get_next_term  # noqa: E402


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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
