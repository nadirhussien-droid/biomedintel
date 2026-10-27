# Upload test results

Page: Safety Tests and Calibration, "Upload test results" (`/testing/upload`). Needs `workorder.work` (Technician, Engineering Manager).

## What it does

1. Download the results sheet (`/testing/upload/template`): one row per open planned job that is waiting for the person (assigned to them, and optionally unassigned ones).
2. Fill in readings from a safety analyser (Rigel, Fluke and similar). Direct import of those export files is not built yet (needs sample files).
3. Upload. The preview saves nothing and lists each row as ready or with a problem.
4. Choose the test tool, tick the declaration, confirm. Each ready row is signed off through `completeWorkOrder`, the same code as the normal form.

## Rules

- Pass or Fail comes from the checklist limits. A reading outside the limits is a Fail; a typed "pass" cannot override it. Where there are no limits, the sheet must say "12.3 pass" or "12.3 fail".
- A Fail, or N/A on a required item, needs a note. An empty required cell stops that row.
- A row with a problem is skipped; other rows still go. Rows are matched by Work order, else by Asset ID when the asset has exactly one open job.
- An electrical safety Fail puts the device on a Do Not Use hold, exactly as in the normal form.
- The test tool must be in use with a calibration that did not fail (checked once, before any row is saved).
- Audit: each job writes its normal entries; the upload also writes `workorder.results_uploaded` with counts and file name.

Code: `lib/test-results-upload.ts` (template, parser, rules), `server/services/test-results-upload.ts`.
