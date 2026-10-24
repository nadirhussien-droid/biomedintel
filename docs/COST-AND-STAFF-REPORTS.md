# Department spend, labour rates and staff effectiveness (25 Oct 2026)

## Labour rates (Reports → Labour rates)

Managers and Organization Administrators (`labour.rates`) set an hourly rate per person, in one currency, from a start date. Rates are never edited or deleted (append-only, audited as `labour_rate.added`); a new rate with a later start date takes over for work logged from that date, so old reports do not change. A person with no rate still has their hours reported, with no money value.

## Department spend by month (Reports → Department spend)

Needs `analytics.financial` (Organization Administrator, Engineering Manager, Auditor); every view is audited. Per department and month: parts (issued minus returned at the recorded unit cost), labour hours and labour cost (logged minutes x the rate in force on the day logged; corrected lines replace the line they fix), and external service (supplier record cost, in the month completed). A job belongs to the department it was raised for; months follow each hospital time zone. Currencies are never converted or added. Unrated hours are counted separately. Charts: total by department, where the money went, labour hours by department. Excel and PDF export.

## Staff effectiveness (Reports → Staff effectiveness)

Needs `analytics.workload` (Organization Administrator, Engineering Manager). Per engineer: jobs completed (repairs and planned), hours logged, hours per job, mean repair time, repeat faults (same device reported again within 30 days of sign-off), reopened jobs, open and overdue now, and planned maintenance on time. There is deliberately no single score or ranking: figures depend on how fully work is recorded and on the difficulty of the jobs. Each view is audited.

## Not built yet

Staff utilisation against working hours (no working hours are configured), labour rates by role, cost per job, and a monthly trend line chart.
