# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Keeping docs in sync

After every change to this repo, update this file and README.md if the
change makes anything they describe stale — a new/removed/renamed file, a
changed behavior, a changed architectural decision, or a changed import
graph (README's "File map" Mermaid diagram in particular). Do this as part
of the same change, not as a followup.

## What this is

A scraper for JHU course listings, scoped to Applied Mathematics &
Statistics, plus a database builder and static visualizer that turn the
scraped terms into a browsable map of how courses connect (prerequisites,
exclusions). Three pieces: `fetch_courses.py` (scraper),
`build_database.py` (extracts connections into a database), and
`docs/index.html` (the visualizer, published via GitHub Pages from `docs/`).

It queries the Typesense search backend behind JHU's public course search
site (https://courses.jhu.edu), not the documented SIS API
(https://sis.jhu.edu/api) — that API never populates its `SectionDetails`
field (no prerequisites, restrictions, or catalog descriptions) and
requires a registered key. courses.jhu.edu itself gets richer data by
fetching a public, search-only-scoped Typesense key from
`https://api.sis.jhu.edu/api/coursesearch/configuration` (the same key every
visitor's browser downloads, unauthenticated) and querying a `sections`
collection directly. This script does the same thing.

## Commands

```bash
pip install requests

python3 fetch_courses.py --term "Fall 2026"          # skip prompt
python3 fetch_courses.py                              # prompts, defaulting to the current term
python3 fetch_courses.py --term "Fall 2026" --yes      # skip overwrite confirmation

python3 build_database.py                              # rebuild db/courses.db + docs/graph.json from data/

python3 -m http.server                                 # serve the repo root, then open
                                                         # http://localhost:8000/docs/ to view
                                                         # the visualizer (fetch() needs http://,
                                                         # not a file:// open)
```

No API key or registration is required.

There is no build, lint, or test suite in this repo. `build_database.py` and
`docs/index.html` use only the Python/JS standard library — no `npm`,
no bundler.

## Automated refresh

`.github/workflows/refresh-courses.yml` runs `scripts/refresh_terms.py`
daily (03:00 UTC, plus `workflow_dispatch` for a manual trigger) as the
`github-actions[bot]` user. The script re-fetches only the current term and
the one right after it (via `fetch_courses.current_term()`/`next_term()` —
the same functions `fetch_courses.py` uses to default its own interactive
prompt, so the script and a bare manual run never disagree on what
"current" means), then reruns `build_database.py`. This is what keeps the
scraped data from going stale between manual runs, and is why a future
term (e.g. `data/2027 Spring/`) can already exist as a real, committed
folder with zero course records: JHU hasn't published that term's sections
yet, and the daily run will pick them up once it does.

`data/*/courses.json`, `courses.csv`, and `docs/graph.json` are gitignored
(see "Data layout" and `docs/graph.json` below) precisely because this
workflow would otherwise touch them every single day — a new commit's
worth of git history for data about to be overwritten again tomorrow. So
the workflow doesn't unconditionally `git add` them; instead
`scripts/refresh_terms.py`'s `archive_stale_terms()` force-adds a term's
files the one time it ages out of the current/next window (i.e. the day
`current_term()`/`next_term()` stop returning it), giving it exactly one
permanent commit as its historical-record snapshot. The workflow's
commit/push step only fires when that staged something (or a human
committed scraper-code changes) — routine day-to-day refreshes of the
still-active current/next term produce no commit at all. Older, already-
archived terms are untouched on every run (force-adding an unchanged file
is a no-op).

`docs/graph.json` itself is never committed at all, even once — GitHub
Pages is configured to deploy from this workflow's build artifact (see the
`docs/` section below), not from a committed file, so there's no need to
ever track it in git.

If the refresh step fails (e.g. a scraping error logged to
`logs/fetch_courses.log` — see above), the workflow uploads that log as a
build artifact (`fetch-courses-log`, via `actions/upload-artifact`, only
if the file exists) before stopping — the job never reaches the commit/push
step on failure, so this is the only way to retrieve the traceback without
re-running the script locally.

Note this is independent of the visualizer's default term filter
(`computeDefaultTerm()` in `docs/js/course-utils.js`), which only ever
resolves to the *current* term, never the next one — so scraping one term
ahead of time doesn't change what term the visualizer opens to by default.

## Architecture

- `fetch_courses.py` first fetches Typesense connection info (node host +
  scoped search key) from `https://api.sis.jhu.edu/api/coursesearch/configuration`,
  then queries `https://{node}/collections/sections/documents/search`,
  paginating with `page`/`per_page` until all hits for the term are
  collected.
- The Typesense filter matches on `AllDepartments` (not `Department`) to
  replicate courses.jhu.edu's own matching behavior: this includes courses
  cross-listed into Applied Mathematics & Statistics even when it isn't
  their primary department (e.g. `EN.500.113` lists `Department: "EN
  General Engineering"` but cross-lists into every WSE department via
  `AllDepartments`). Filtering on `Department` instead silently drops these.
- `term_to_folder()` converts an API term string like `"Fall 2026"` into the
  on-disk layout `data/2026 Fall/` (year/season order flipped from the API's
  season/year order). This mapping is the one non-obvious piece of logic in
  the script — the API and the file layout use different orderings.
- `current_term()` guesses the in-progress/upcoming term from today's date
  (Jan–Jun → `Spring {year}`, Jul–Dec → `Fall {year}`) and is used as the
  prompt's default when `--term` is omitted (blank input accepts it). It
  mirrors `computeDefaultTerm()` in `docs/js/course-utils.js` so a bare
  `fetch_courses.py` run scrapes the same term the visualizer opens to by
  default — but the two are only kept in sync by convention, not by a
  shared source, so update both if the rule ever changes.
- Output per term is a pair of files in that folder: `courses.json` (the raw
  list of Typesense section documents, one per section — each includes a
  nested `SectionDetails` object with `Prerequisites`, `Restrictions`,
  `CoRequisites`, and a full catalog `Description`) and `courses.csv`
  (flattened; list/dict fields are JSON-encoded into a single cell).
- Before writing, the script checks whether either output file already
  exists and prompts to confirm overwrite (bypass with `--yes`/`-y`). This
  check happens *before* the Typesense call, so declining doesn't waste a
  request.
- If the configuration or search request fails (network error, bad
  response, etc.), the script appends a timestamped entry with a traceback
  to `logs/fetch_courses.log` (gitignored, created on first error) and
  exits with status 1, rather than dumping a bare traceback and leaving no
  record for the unattended weekly run to be debugged from later.
- Default query scope is school `Whiting School of Engineering`, department
  `EN Applied Mathematics & Statistics`; override with `--school`/
  `--department` to scrape other JHU departments with the same script.

## Data layout

`data/<Year> <Season>/` holds one `courses.json` + `courses.csv` pair per
term already fetched (e.g. `data/2023 Spring/`, `data/2026 Fall/`). Once a
term is no longer the current or next one, its pair is committed to the
repo as a permanent historical record. The current and next term are the
exception — their files are gitignored and rebuilt fresh by the daily
refresh instead of committed on every run; see "Automated refresh" above
for how and when they eventually do get committed.

## build_database.py

Reads every `data/*/courses.json` and collapses per-term/per-section records
into one row per course, extracting the relationships between courses:

- **Prerequisites** — JHU encodes these as a string like
  `"(^A[C]^OR^B[C]^)^AND^C[C]"`; splitting on `^` tokenizes it into course
  codes, `AND`/`OR`, and parens. A handful of expressions mix `AND`/`OR` at
  the same nesting depth without full parens (e.g. `EN.553.488`'s prereq) —
  the parser follows conventional precedence (`AND` binds tighter than
  `OR`) since even JHU's own human-readable description of that expression
  leaves the ambiguity unresolved.
- **Exclusions** — `IsNegative: "Y"` on a prerequisite entry.

JHU's `CoRequisites` field is read from the scraped data but never
extracted into the database or graph — despite the name, it's always
actually a same-term mutual-exclusion rule ("may not be taken concurrently
with"), never a true corequisite. The visualizer's graph isn't scoped to a
single term, so there's no way to distinguish "can't combine in the same
term" from any other relationship on it; rather than mislabel it as a
generic exclusion, the field is dropped entirely.

`EN.550.*` is the department's old numbering, from before it was renumbered
to `EN.553.*`; it never appears as a scraped course, only as a stale
reference inside another course's prerequisite data (JHU's own records
still carry the old codes in a handful of spots). The renumbering only
ever swapped the department prefix, not the course number, so most
`EN.550.NNN` references map 1:1 onto a still-live `EN.553.NNN` course and
are remapped onto it (via a `deprecated_map` built in `build_courses()`)
rather than discarded — e.g. `EN.553.720`'s recorded exclusion against
`EN.550.620` really means `EN.553.620`. Only references with no live
`EN.553.NNN` counterpart (a handful of genuinely discontinued courses) are
dropped completely — not even a stub node — via
`is_deprecated_code()`/`strip_codes()` in `build_courses()`.

Only `EN.553.*` codes count as real AMS courses. Any other code referenced
as a prerequisite of an AMS course (e.g. `AS.110.202` Calculus
III, or a cross-listed `EN.500`/`EN.601` course pulled in via
`AllDepartments` matching) gets a stub node instead of a full one, titled
from JHU's own `PrereqCoursesCatalogs` metadata or its own scraped title
when available — even if it was scraped as its own record, so it's never
treated as a first-class AMS course. If neither source gives it a title,
it's dropped the same way unresolved `EN.550.*` references are — a stub
with no title and no data of its own isn't worth a node.

500-level, 800-level, and "Independent Academic Work"-level sections (JHU's
label for independent-study arrangements) are dropped before they're
collapsed into a course row (`is_excluded()`) — these are one-off
student/faculty arrangements, not real courses, and add nodes to the graph
with little to no navigational value. Nothing else in the scraped data
references them as a prerequisite, so dropping them doesn't leave dangling
stub nodes behind.

Many AMS courses are cross-listed as both a 4xy undergraduate number and a
6xy graduate number with an identical title — the same course offered at
two levels, where JHU's own data frequently records the real
prerequisites under only one of the two numbers and leaves the other with
nothing but a mutual "can't take both" exclusion.
`merge_grad_undergrad_pairs()` merges each such pair into a single node
(`EN.553.4xy/6xy`), combining every field losslessly and remapping every
course's prerequisite references — not just the pair's own — from the two
old codes to the merged one. The merged node carries `is_merged`/`merged`
(SQLite column and graph node field respectively), is visible regardless
of the visualizer's Undergraduate/Graduate filter, and shares the 400s
column with the handful of 400-level courses that had no matching 6xy
cross-listing to merge with (see `levelDigit()` in
`docs/js/course-utils.js`).

Two outputs, both fully reproducible by re-running the script:
- `db/courses.db` (SQLite, gitignored) — the queryable source of truth,
  with prerequisite logic stored as a tree via `parent_id` rather than
  flattened, so `(A or B) and C` round-trips exactly. Most tables
  (`courses`, `prereq_nodes`) hold one row per course,
  since that's the collapsed unit the rest of the script works with.
  `course_sections` is the exception: it keeps one row per actual section
  per term (`instructors`, `syllabus_url`, `max_seats`, `seats_available`,
  `waitlisted`, `status`, `meetings`, `building`) because a single course
  can have many sections in the same term taught by different people —
  that data doesn't collapse to one row per course the way everything else
  does. `meetings` is JHU's own human-readable schedule string (e.g. `"MWF
  12:00PM - 12:50PM, T 9:00AM - 9:50AM"`, comma-separating multiple meeting
  blocks per section) rather than the raw `DaysOfWeek`/`StartTime`/
  `EndTime` fields, since those only capture a section's first meeting
  block; `building` is comma-separated in step with `meetings` for
  sections that meet in more than one room. It's *not* JHU's own top-level
  `Building` field, which is a deduped, alphabetically sorted set of
  buildings out of step with `Meetings`' chronological order —
  `ordered_building()` rebuilds it instead from the per-meeting
  `SectionDetails.Meetings` list, which carries a `Building` alongside each
  entry in the same order `Meetings` was built from.
- `docs/graph.json` (gitignored) — a nodes/edges flattening of the same data
  for `docs/index.html` to fetch directly; no server-side build step. Each
  node's `sections` array mirrors `course_sections` (term, section,
  instructors, syllabus_url, enrollment, meetings, building) and is
  rendered as a per-section table in the visualizer's detail panel.

## docs/ (the visualizer)

`docs/index.html` is a thin HTML shell — `docs/css/*.css` and
`docs/js/*.js` hold the actual styling and logic. There is still no build
step: the CSS files are plain `<link>` stylesheets and the JS files are
native ES modules (`docs/js/main.js` loaded via `<script type="module">`),
so nothing needs `npm`/bundling to run — serving `docs/` over `http://`
(see Commands above) is enough.

- `docs/css/theme.css` — light/dark color tokens (custom properties).
- `docs/css/base.css` — reset and the top-level flex shell.
- `docs/css/header.css` — title bar and the filter/legend row.
- `docs/css/graph.css` — canvas, tooltip, hint/status overlays.
- `docs/css/panel.css` — the course detail side panel and its section table.
- `docs/css/loading.css` — the loading/error states shown over the canvas.
- `docs/js/constants.js` / `course-utils.js` — static lookup tables and pure
  term/course-code helpers with no shared state.
- `docs/js/store.js` — the one shared mutable state object (loaded graph,
  camera, current filters, hover/selection/search focus) that every other
  module reads and writes through, plus `buildFromGraph()` which populates
  it from a freshly-fetched `graph.json`.
- `docs/js/layout.js` — the static layered layout (see below).
- `docs/js/camera.js` — pan/zoom/resize and the canvas pointer/wheel wiring.
- `docs/js/render.js` — `draw()`, the only thing that touches the canvas
  2D context.
- `docs/js/tooltip.js` — the hover tooltip.
- `docs/js/theme.js` — reads resolved CSS custom properties (`cssVar()`,
  `isDarkMode()`) and wires the theme-toggle button, which overrides the
  OS-level light/dark preference via `[data-theme]`.
- `docs/js/ribbon.js` — the arrow toggle that collapses/expands the header
  controls and filters ribbon down to just the title.
- `docs/js/panel.js` — the detail side panel's DOM and its resize handle.
- `docs/js/filters.js` — filter state, the URL query-string round-trip, and
  the filter controls' DOM wiring.
- `docs/js/main.js` — entry point; wires the modules together and drives
  the initial `graph.json` fetch.

README.md's "File map" section has a Mermaid diagram of `docs/js/`'s import
graph (rooted at `main.js`, edges = imports) with the same per-file
summaries as above; keep both in sync whenever a file under `docs/` is
added, removed, or its imports/purpose change.

Modules avoid circular imports by passing callbacks at init time rather
than importing each other directly where a cycle would otherwise form
(e.g. `panel.js` takes an `onSelectionChange` callback instead of importing
`filters.js`'s URL-sync function).

The visualizer renders the graph as a **static** layout: one column per
course level (the course number's hundreds digit, so `EN.553.310` sits in
the "300s" column), ordered top-to-bottom within each column by a one-time
barycenter sweep against connected courses to reduce crossings. Node fill
color encodes level (categorical, one hue per column); edge dash pattern
encodes relationship type (solid+arrow = prerequisite, dashed = mutually
exclusive). There is no physics simulation —
positions are computed once at load and never move on their own; the only
interactivity is pan/zoom/click.

This folder is the GitHub Pages source, but via an Actions-based deploy
(repo Settings → Pages → Source → GitHub Actions) rather than serving the
branch's `docs/` folder directly: `.github/workflows/refresh-courses.yml`
rebuilds `graph.json` on every run and publishes the whole `docs/` folder
as a Pages artifact (`actions/upload-pages-artifact` +
`actions/deploy-pages`), so `graph.json` never needs to be committed — it
and `db/courses.db` are both gitignored. Regenerate both locally with
`python3 build_database.py` after re-scraping a term (the live site only
picks up local changes once pushed and the workflow runs).
