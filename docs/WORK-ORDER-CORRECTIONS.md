# Correcting a completed job

Decision of 24 Oct 2026 (Nadir): a signed-off job can be corrected without
reopening it, by anyone who worked on it.

## Who

- The assigned technician, the person who signed it off, anyone who logged work
  on it, and managers (Engineering Manager, Organisation Administrator).
- Everyone else (other technicians, department heads, auditors, fault
  reporters) cannot. Refusals are audited.

## What can be corrected

- Diagnosis (or Notes on planned jobs), Work done and result, and the fault
  category of a repair.
- Each line of the work log (text and minutes). The line is replaced by a new
  one that points at the old one; the old one stays in the database. The work is
  still credited to the technician who did it. Reports count the current version
  only.

## What cannot be corrected here

Outcome, functional and electrical safety results, checklist values, the
declaration, who signed off, and the device status. If those are wrong a manager
must **reopen** the job (the device goes back to Under repair and the job is
signed off again).

## Safeguards

- A reason (5 to 500 characters) is required for every correction.
- The old value, new value, person and time are kept in `work_order_corrections`
  (append-only: the database refuses edits and deletes).
- The job timeline shows "Job corrected" and "Work log line corrected".
- The audit log records which fields changed, never the text.
- The assigned technician and the person who signed off are notified.
- The printed job sheet notes that it was corrected after sign-off.

## Database change

Migration `20261024000500_work_order_corrections`: one new table and three
optional columns on `work_order_tasks`. Add-only; existing data is untouched.
