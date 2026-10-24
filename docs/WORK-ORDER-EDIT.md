# Editing a completed job

Decision of 24 Oct 2026 (Nadir): a completed job has one **Edit** button. Nothing
on the job page or the printed job sheet says the job was edited.

## Who sees the Edit button

The technician, biomedical engineer or Engineering Manager who **worked on the
job**: assigned to it, signed it off, or logged work on it. Others (including a
manager or Organisation Administrator who did not work on it) do not. Refused
attempts are audited.

## What can be edited

- Diagnosis (Notes on planned jobs) and Work done and result.
- Fault category of a repair.
- Every line of the work log: text and minutes. The work stays credited to the
  person who did it. Reports count the edited minutes.
- An optional note can be added; it is not shown on the job.

## What cannot be edited

Outcome, functional and electrical safety results, checklist values, the
declaration, who signed off, and the device status. A failed safety test must
go through the safety hold and retest. If these are wrong, a manager reopens
the job.

## Kept in the background (not shown on the job)

Medical equipment records must be traceable, so the earlier values are kept:

- `work_order_corrections`: old and new diagnosis, work done or category, who
  and when (append-only).
- Edited work log lines: the original line stays in the database; the job shows
  the latest version.
- Audit log entry `workorder.edited_after_completion` with which parts changed
  (never the text). Only Organisation Administrators and Auditors see the audit
  log.

## Database change

Migration `20261024000500_work_order_corrections`: one new table and three
optional columns on `work_order_tasks`. Add-only; existing data is untouched.
