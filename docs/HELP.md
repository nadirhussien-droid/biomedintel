# Help panel and "Report a problem" (24 Oct 2026)

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Requested by Nadir Isse after trying the staging site. Mockup approved on 24 Oct 2026. Backlog item B-15.

## What people see

- A **Help** button at the top of every page opens a side panel.
- **This page** tab: 3 to 6 short steps for the screen the person is on, written for their role, with the app's own button and field names in bold. Safety rules appear in an "Important" box, for example a failed electrical safety test.
- **Report a problem** tab: the person chooses the kind of problem (not working, unclear, suggestion), describes it and sends it. The page and their role are attached automatically. A reminder says not to include patient details.
- The **Organisation Administrator** gets an in-app notification and sees each report under **Admin → Problem reports**, open ones first, and can **Mark as resolved**. Resolved reports are kept.

## Help topics

The content is in `lib/help/topics.ts`:

- report a fault;
- a job for a technician, a manager, or anyone following it;
- the work order list;
- adding a device, the equipment catalog, opening by barcode, and the register;
- writing, approving and enrolling a maintenance plan;
- safety holds and other planned maintenance;
- reports and exports;
- organisation set-up;
- spare parts;
- knowledge and IntellAssist;
- the dashboard;
- general help for any other page.

A test (`tests/unit/help-topics.test.ts`) checks that every **bold** name in the help appears on the app's screens. A renamed button makes the test fail until the help is updated.

## Safety and privacy

- **Permissions:** everyone signed in may send a report (`feedback.submit`). Only the Organisation Administrator may read and resolve them (`feedback.manage`). Refusals are audited.
- **Isolation:** reports have row-level security (enabled and forced). One organisation can never see or write another's reports.
- **Never deleted:** the database refuses deletion. The application role can change only the resolution columns.
- **Text kept out of the audit log:** the audit records the kind, the page and the length, never the message.
- **Limits:** messages of 5 to 2,000 characters; at most 10 reports per person in 24 hours. The page is stored as a plain app path (query strings dropped; anything else becomes "/").
- **No email and no new service.** Notifications are in the app only.

## Database change

Migration `20261024000300_problem_reports` adds one table, `problem_reports`. It only adds.

## Tests (24 Oct 2026, local, fictional data)

- Unit: 5 help-content tests, including the bold-name check.
- Integration: 6 tests. Covered:
  - sending, notification, and the audit without text;
  - validation and page clean-up;
  - the daily limit;
  - administrator-only reading and resolving;
  - another organisation refused;
  - no deletion and the database rules.
- Browser, 14 of 14 checks:
  - technician help on a job;
  - focus moves into the panel, and Escape returns it to the button;
  - arrow keys switch tabs;
  - a report sent and stored with page and role;
  - fault reporter help;
  - the administrator sees, resolves and is notified.
- Accessibility (axe, WCAG 2.1 AA): 0 violations with the panel open on desktop and phone, and on the admin and notifications pages.

## Not done

- A searchable help guide and AI answers (left for later, as agreed).
- Email copies of reports (needs an email provider, backlog B-10).
