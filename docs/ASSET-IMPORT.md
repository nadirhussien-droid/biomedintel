# Bulk upload of equipment (24 Oct 2026)

Page: **Equipment Assets → Upload assets** (`/assets/import`). Open to roles that can both register assets and add to the catalog (Organisation Administrator, Engineering Manager, Technician).

## Steps

1. Download the template (or use an export from another system) and fill it in. Accepted: `.xlsx` and `.csv`, up to 1,000 assets and 3 MB. Old `.xls` files must be saved as `.xlsx` first.
2. Choose the hospital and department, then the file.
3. **Preview.** Nothing is saved. Each row shows _Will be added_, _Already there_ (skipped) or _Problem_, with the reason.
4. Tick the authorisation box and confirm. The batch is audited (`asset.bulk_imported`: file name, counts, authorisation) and each asset has its normal `asset.created` entry.

## Rules

- The Asset ID is kept exactly as written (capitals). An ID already in the register is skipped, so the same file can be uploaded again safely.
- Missing manufacturers, categories, models and rooms are created automatically (audited like manual additions). Names match ignoring capital letters.
- Only Asset ID, Manufacturer, Model and Category are needed. A missing name uses the category; a missing manufacturer becomes "Unknown"; a missing model "Not specified"; a missing category "Uncategorised".
- Column names are matched loosely: for example `Control #` is the Asset ID, `Asset/Property #` the inventory number, `Model Description` the category.
- Several lines for the same asset (a work order export) are combined into one asset.
- All-capital text in names and categories is changed to Title Case. Manufacturer and model are left as written.
- A repeated serial number on the same model is a warning, not a block. A repeated inventory number in the hospital is a problem.
- Unusable status, risk or purchase date values are ignored (status becomes In service); the preview says so.
- The server re-checks every row on confirm: scope, permission, duplicates and the same field rules as the single Register asset form. The browser only carries the rows between the two steps.
- A row that fails while saving does not stop the others; the result lists them.
- Cost is never imported (only some roles may record it).
