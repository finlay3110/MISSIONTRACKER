# UCN Mission Analytics

A fan-made mission tracker for [Bridge Command](https://bridgecommand.co.uk).
Import a CSV of the missions you have flown and get monthly counts, ship and
role breakdowns, charts, and a printable PDF service record.

**Fan-made. Not affiliated with, endorsed by, or connected to Bridge Command or
The London Space Elevator Ltd.**

## Using it

Open `index.html`. That is the whole application — one self-contained file with
no build step, no npm, and **no network requests of any kind at runtime**. Fonts
(Exo 2, Orbitron) and the PDF engine (jsPDF) are embedded as base64 inside the
file, so it works on a cold first launch with the network off. Everything you
enter stays in that browser's local storage until you delete it.

Designed for a phone in a dark room: dark-only, dense, one-handed, ~414×896.

### Tabs

| Tab | What it does |
|---|---|
| Setup | Who is logging and what the sortie is. Heads the PDF cover. |
| Import | Load a CSV, map its columns, review what will be skipped, import. |
| Charts | Missions per month, cumulative record, ship / role / type / outcome splits, filters, PDF export. |
| Log | Every logged mission as a card. Add, edit and delete by hand. |
| More | CSV template, JSON backup and restore, clearing, licences, disclaimer. |

### CSV format

Only a date column is required; everything else is optional. Download a
template from the More tab.

```csv
date,ship,role,mission,type,outcome,duration,notes
2182-01-14,UCS Takanami,Helm,Silent Harbour,Frontline,Objective met,90,Lost port thruster
2182-02-03,UCS Havock,Comms,Ridgeline Parley,Diplomacy,Stood down,75,
```

- Comma, semicolon, tab and pipe separators are detected automatically, as are
  quoted fields containing separators or newlines.
- Dates may be ISO (`2182-01-14`), day-first, month-first, or written out
  (`14 Jan 2182`). Where day and month are both 12 or under the file is
  ambiguous; the tool says how many rows were affected and defaults to
  day-first. Two-digit years are refused rather than guessed.
- Duration accepts minutes (`90`), `1h 30m`, or `1:30`.
- If there is no header row, columns are read in template order, and the date
  column is found by looking at the data.
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
test/                       Playwright checks
```

### Rebuilding

```sh
python3 build/build.py
```

Edit `src/index.template.html`, never `index.html` — the latter is generated.

### Tests

```sh
NODE_PATH=/opt/node22/lib/node_modules node test/smoke.js        # happy path, offline, layout, PDF
NODE_PATH=/opt/node22/lib/node_modules node test/edge.js         # odd CSVs, empty state, blocked storage, a11y
NODE_PATH=/opt/node22/lib/node_modules node test/pdf-preview.js  # renders the PDF's drawing calls to PNGs
```

`smoke.js` asserts that the page makes **zero** non-`file://` requests.

`pdf-preview.js` exists because no PDF rasteriser is available in this
environment: it swaps jsPDF for a canvas-backed stand-in with the same API, so
the report's geometry, pagination and table page-breaks can be checked by eye
in `.smoke/pdf/`.

## Licences

- **Exo 2**, **Orbitron** — SIL Open Font License 1.1 (`vendor/fonts/OFL-*.txt`)
- **jsPDF** 4.2.1 — MIT, © 2010–2025 James Hall and yWorks GmbH
  (`vendor/jspdf/LICENSE.txt`)

Both are embedded unmodified.
