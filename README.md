# UCN Mission Analytics

A fan-made service record for [Bridge Command](https://bridgecommand.co.uk).
Import your deployment CSV and get monthly counts, ship and mission-type
breakdowns, charts, star ratings, and a printable PDF service record.

**Fan-made. Not affiliated with, endorsed by, or connected to Bridge Command or
The London Space Elevator Ltd.**

## Using it

Open `index.html`. That is the whole application — one self-contained file with
no build step, no npm, and **no network requests of any kind at runtime**. Fonts
(Exo 2, Orbitron) and the PDF engine (jsPDF) are embedded as base64 inside the
file, so it works on a cold first launch with the network off. Everything you
enter stays in that browser's local storage until you delete it.

Designed for a phone in a dark room: dark-only, dense, one-handed, ~414×896.

You type two things: your **name** and your **rank**. Your **date of first
deployment** fills itself in from the earliest mission in your CSV (you can
override it). Everything else — dates, ships, mission names, mission types —
comes out of the file.

Two things are yours to add afterwards, both optional:

- **Role** — which station you played. A dropdown on each mission in the Log
  tab, with a free-text option for anything not on the list.
- **Rating** — out of 5 stars, tapped straight on the mission card.

### Tabs

| Tab | What it does |
|---|---|
| Setup | Name, rank, and the first-deployment date read off your CSV. |
| Import | Load a CSV, check what it read, import. |
| Charts | Missions per month, cumulative record, ship / role / type / rating splits, filters, PDF export. |
| Log | Every mission as a card. Rate it, set a role, edit or delete. |
| More | CSV template, JSON backup and restore, clearing, licences, disclaimer. |

### CSV format

A Bridge Command deployment export works as-is:

```csv
Date,Ship,Category,Mission
2026-08-20,UCS Takanami,Exploration,OPERATION SARGASSO
2026-08-06,UCS Havock,Frontline,CELL 06-05
```

Only a date column is required; `Ship`, `Category` (mission type) and `Mission`
are picked up by name. `Role`, `Rating`, `Outcome`, `Duration` and `Notes` are
read too if your file has them. Download a template from the More tab.

- Comma, semicolon, tab and pipe separators are detected automatically, as are
  quoted fields containing separators or newlines.
- Dates are taken exactly as written — a 2026 export stays 2026, and the report
  is stamped in the same reckoning. Nothing is shifted behind your back.
- ISO, day-first, month-first and written-out (`14 Jan 2182`) dates all parse.
  Where day and month are both 12 or under the file is ambiguous; the tool says
  how many rows were affected and defaults to day-first. Two-digit years are
  refused rather than guessed.
- Columns are matched by header name, and the date column can also be found by
  reading the data. Nothing is ever guessed from column *position* — a file
  whose columns sit in an unexpected order would be mislabelled silently, so a
  headerless file opens the mapping and asks.
- Rows that cannot be used are never dropped quietly: each one is listed with a
  reason, on screen and in the PDF.

Imported text is treated as data throughout. It is escaped before it reaches
the DOM and drawn as plain text in the PDF; it is never evaluated.

## Repository layout

```
index.html                  the deliverable — open this
src/index.template.html     source, with placeholders for the vendored blobs
build/build.py              inlines jsPDF and the four TTFs into index.html
vendor/fonts/               Exo 2 Regular/Bold/Italic, Orbitron Bold (+ OFL)
vendor/jspdf/               jsPDF 4.2.1 UMD build (+ MIT licence)
test/                       Playwright checks and a CSV fixture
```

### Rebuilding

```sh
python3 build/build.py
```

Edit `src/index.template.html`, never `index.html` — the latter is generated.

### Tests

```sh
NODE_PATH=/opt/node22/lib/node_modules node test/smoke.js        # happy path, offline, ratings, layout, PDF
NODE_PATH=/opt/node22/lib/node_modules node test/edge.js         # odd CSVs, empty state, blocked storage, a11y
NODE_PATH=/opt/node22/lib/node_modules node test/pdf-preview.js  # renders the PDF's drawing calls to PNGs
```

`smoke.js` asserts that the page makes **zero** non-`file://` requests.

`pdf-preview.js` exists because no PDF rasteriser is available in this
environment: it swaps jsPDF for a canvas-backed stand-in with the same API, so
the report's geometry, pagination and table page-breaks can be checked by eye
in `.smoke/pdf/`.

`test/fixture-deployments.csv` is a real Bridge Command deployment export, kept
as a regression fixture: quoted fields throughout, a `Category` column instead
of `Type`, no role column, and a `Both Ships` value.

## A note on stars

No embedded font carries U+2605, and jsPDF omits a glyph the font lacks without
raising anything. Ratings are therefore drawn as shapes in both places — inline
SVG on screen, vector polygons in the PDF — rather than typed as characters.

## Licences

- **Exo 2**, **Orbitron** — SIL Open Font License 1.1 (`vendor/fonts/OFL-*.txt`)
- **jsPDF** 4.2.1 — MIT, © 2010–2025 James Hall and yWorks GmbH
  (`vendor/jspdf/LICENSE.txt`)

Both are embedded unmodified.
