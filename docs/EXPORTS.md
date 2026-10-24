# Exports: Excel, PDF and CSV (24 Oct 2026)

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Requested by Nadir Isse: "export in CSV doesn't make sense, it's not Excel or PDF which is readable". Backlog item B-13.

## What people see

Every export now offers three buttons: **Excel**, **PDF** and **CSV**.

| Where                                   | Export                                   |
| --------------------------------------- | ---------------------------------------- |
| Reports and Analytics, every report (8) | Export: Excel / PDF / CSV                |
| Reports → PM compliance                 | Export summary, and Export each due date |
| Reports → Safety                        | Export test history                      |
| Equipment Assets (register)             | Export register                          |

- **Excel (.xlsx):** title, organisation, filters, export time and the person who exported it at the top. Bold header row, filters switched on, column widths set, header kept in view when there is one table. Numbers are numbers and dates are dates, so sorting and sums work.
- **PDF (A4):** the organisation's optional logo (Admin → Hospital logo) and name, the report title and filters, tables that wrap long text and repeat their header on every page, landscape for wide tables, "Page x of y", and a footer: who exported it, when, and "Equipment records only, no patient information". A PDF table stops at 2,000 rows with a note; Excel and CSV carry every row.
- **CSV:** unchanged, byte for byte, for moving data into other systems.

## Safety and security

- **Same data as the screen.** All three formats come from one document built from the same permission-checked, scope-filtered rows. A format can never show more than the screen.
- **Permissions unchanged:** analytics and PM exports need `analytics.export` or `pm.export`, the register needs `asset.export`. A technician or fault reporter gets nothing in any format.
- **Audited:** each export records its format (`analytics.exported`, `pm.report_exported`, `asset.exported`).
- **No formulas.** In Excel, text is always stored as text, so a value such as `=HYPERLINK(...)` is shown, never run. CSV keeps its existing protection (a leading `'`).
- **No new service or cost.** The files are made on the server with open-source libraries: exceljs 4.4.0 (MIT), pdfkit 0.20.2 (MIT) and the DejaVu fonts 2.37.3 (free licence, so names and units such as Ω print correctly).

## Security update made at the same time

Installing the libraries showed new advisories, unrelated to the exports:

- **Next.js 16.3.8 → 16.4.3**: critical advisories GHSA-2464-fhr4-w9xw and GHSA-673q-mjm6-r5xr, plus GHSA-p3m5-59mp-jv5r. They affect 16.0.0 to 16.4.0, which includes the staging site. Nadir approved patching now ("Patch now", 24 Oct 2026), although the fixed version was only 1 day old.
- **Zod 4.6.5 → 4.6.7**: high advisory GHSA-mrhx-c7xc-m3w5.
- exceljs depends on an old uuid with a moderate advisory (GHSA-w5hq-g745-h8pq). It is overridden to uuid 11.1.1. exceljs only calls `v4()`, which is unchanged.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Tests (24 Oct 2026, local, fictional data)

- `tests/integration/exports.test.ts` (10 tests):
  - all 8 reports export to Excel and PDF with title, organisation and page numbers;
  - CSV layout unchanged;
  - Excel numbers and dates are real values, and formula text stays text;
  - PDF Unicode, header repeated on each page, and the 2,000-row cap;
  - logo only when uploaded;
  - no other organisation's records;
  - audit with format;
  - permissions in every format.
- `tests/e2e/exports.test.ts` (HTTP): downloads with the right file type and name, CSV still the default, technician refused, buttons on report pages.
- Files opened and checked: Excel read back with an independent reader (openpyxl) and opened in LibreOffice; PDFs rendered to images and read back as text.

## Not verified

- Opening the files in Microsoft Excel and Adobe Reader on Windows or Mac. LibreOffice and two independent readers were used.
- Very large exports on the staging server (time and memory). Locally a 2,100-row PDF took a few seconds.
