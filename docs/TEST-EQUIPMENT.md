# Test equipment and calibration certificates (24 Oct 2026)

Page: **Safety Tests and Calibration** (`/testing`). Everyone who can view equipment sees it (Org Admin, Engineering Manager, Technician, Inventory Manager, Auditor). Org Admin, Engineering Manager and Technician can add and edit (`testing.view`, `testing.manage`).

## What it holds

- **Test equipment:** the tools used to test other devices (safety analyser, defibrillator tester, flow analyser, pressure meter, simulator, multimeter, thermometer, weights or scale, other). Name, type, manufacturer, model, serial number, optional own ID, what it measures, calibration interval (months), who holds it, where it is kept, status (In use, Out of service, Retired), notes. Details can be edited; nothing is deleted (retire instead).
- **Calibration records:** calibration date, next due date (blank = date + the tool's interval), laboratory, certificate number, accreditation, traceable to, result (Passed, Passed after adjustment, Failed), notes. Records are never changed or deleted: a mistake is corrected by adding a new record.
- **Certificates:** a PDF (checked by content, up to 5 MB) attached when recording, or added later to a record that has none. A certificate is never replaced. Opening and downloading are audited.

## Status on the list

No calibration recorded · In calibration · Due soon (30 days) · Calibration overdue (from the day after the due date) · Failed calibration: do not use. Based on the latest record. Dates use the Africa/Nairobi day.

## Standards

IEC 62353 stays the default for electrical safety tests, AS/NZS 3551 and the other standards stay as before (see docs on test standards); nothing was removed for Australia.

## Not built yet

Electrical safety test results linked to the tool used, reminders before a calibration is due, blocking tests done with an out-of-calibration tool, and the compliance report.

## Audit events

`test_equipment.created`, `test_equipment.updated`, `calibration.recorded`, `calibration.certificate_added`, `calibration.certificate_opened`, `calibration.certificate_downloaded`.
