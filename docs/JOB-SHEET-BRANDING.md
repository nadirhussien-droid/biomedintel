# Job sheet branding: optional hospital logo (22 Oct 2026)

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Requested by Nadir Isse after trying the staging job sheet. Backlog item B-11.

## What changed

| Area                     | Before                                                         | Now                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job sheet header         | BiomedIntel.ai mark and name; organisation name in small print | The **organisation name** is the title. If the organisation uploaded a logo, it is printed beside the name. No BiomedIntel.ai mark in the header                                                     |
| Credit to BiomedIntel.ai | Header and footer                                              | Footer only ("Printed … from BiomedIntel.ai")                                                                                                                                                        |
| Asset ID box             | 14 pt text, box stretched down to the height of the details    | Compact box that does not stretch; the text is 10 pt and shrinks for long IDs (up to the 40-character limit) so it always fits                                                                       |
| Hospital logo            | Not possible                                                   | **Optional.** The Organisation Administrator uploads or removes it in **Admin → Hospital logo**. Once uploaded it prints on every job sheet automatically. Without one the sheet shows the name only |

## Rules

- **Optional, never blocking.** A missing logo never stops anything from printing.
- **Who:** only an Organisation Administrator may set or remove the logo (`logo.manage`). Every signed-in member of the organisation can see it, because it prints on the sheets they can open. Refusals are audited.
- **Files:** PNG or JPEG, up to 2 MB. The file is decoded and re-encoded by the server (hidden data removed), scaled to fit 800 × 400 px and stored in the database (at most 1 MB). **SVG, GIF and other formats are refused**, because an SVG can carry script.
- **Isolation:** the table has row-level security (enabled and forced). One organisation can never read or write another's logo. The newest row is the current logo.
- **History, not deletion:** setting or removing a logo adds a row. Nothing is updated or deleted (the database refuses it). Both actions are written to the audit log (`organization.logo_set`, `organization.logo_removed`).
- No external service, no new cost.

## Scope

Only the work order **job sheet** has a printed header today. Asset barcode labels are small stickers, and the CSV exports are plain data files, so neither carries a logo. If more printed reports are added later, they should use the same header.

## Database change

Migration `20261022000100_organization_logo` adds one table, `organization_logos`. It only adds. Nothing existing is changed or removed.

## Tests (22 Oct 2026, local, fictional data)

- 379 unit and integration tests passed (370 before, plus 9 new for the logo).
- HTTP tests: the logo route (read, upload and remove permissions, cross-site refusal, signed-out refusal) and the job sheet without a logo.
- Browser walk-through, 13 of 13 checks: upload as administrator, preview, logo and name on the job sheet, no BiomedIntel.ai header, compact asset ID box, a technician can read but not change, the other organisation gets "not found", removal.
- 10 upload and remove cycles in a row, each updating the page at once.
- Asset ID fits for 3 IDs (`V-1`, 12 characters, 25 characters).
- Accessibility (axe, WCAG 2.1 AA): 0 violations on the Admin page and the job sheet, with and without a logo, at desktop and phone width.
- Lint, formatting, TypeScript and the production build pass. The migration safety check passes.

## Not verified

- Printing on a **real printer** and **real paper**, and how a very wide or very tall logo looks when printed. Logos are scaled to fit in a 40 × 14 mm space.
- Deployment to staging: it needs a push to GitHub and a manual deploy on Render.
