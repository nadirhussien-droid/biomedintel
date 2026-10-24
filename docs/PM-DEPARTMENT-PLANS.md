# Maintenance plans for a whole department (24 Oct 2026)

BiomedIntel.ai — _Smarter Maintenance. Safer Healthcare._

Requested by Nadir Isse while trying the staging site. Backlog item B-12.

## What changed

A maintenance plan could apply to **one asset**, **every asset of one model** or **every asset in one category**. It can now also apply to **every asset in one department** (for example, a six-monthly inspection of everything in the ICU).

On **Maintenance → Plans → New plan**, choose **Applies to → Every asset in one department**, then pick the hospital and the department. The department list shows only the departments of the chosen hospital that you may use.

## Rules (the same safety rules as the other plan types)

- **A department plan belongs to one hospital.** The hospital must be chosen, and the department must belong to it. The database enforces this.
- **Interval source:** a department mixes different makes, so the interval **cannot** be "Manufacturer recommendation". Use a regulatory or organisational requirement. "Organisation-defined" is accepted only if none of the department's equipment has manufacturer guidance on record. This follows the existing order: requirement, then manufacturer, then organisation-defined. In practice most departments will use a requirement.
- **Approval first.** A new plan is a draft, creates no work, and needs approval by an Engineering Manager. After approval its type and target are fixed. To change the department, create a new plan.
- **Enrolling assets** is still a step on the plan page (**Assets in this plan**). The page counts the active assets of the department that you may see. Assets added to the department later are **not** enrolled automatically; enrol them from the plan page.
- **One live plan per asset and type.** An asset already scheduled by another plan of the same maintenance type is skipped, with the plan's name shown.
- **Scope:** a department-limited manager can only write plans for their own departments. Decommissioned and archived assets are never enrolled.
- Work orders are created by the daily job exactly as for other plans (checked in the tests: a department plan creates a linked work order for an enrolled asset).

## Database change

Two migrations, because PostgreSQL does not let a new enum value be used in the step that adds it:

1. `20261024000100_plan_target_department_enum` adds the `DEPARTMENT` value.
2. `20261024000200_plan_target_department` adds `department_id` to `maintenance_plans`, a foreign key that ties the department to the plan's hospital, and the rules above.

The second migration **replaces** one existing safety rule (`maintenance_plans_target`: exactly one target) with an extended version that also covers departments. The migration safety check flags any dropped rule, so it is listed in `prisma/migrations/reviewed-destructive.json`. **The owner's confirmation is still needed before deployment.** No existing plan changes: every existing plan has an empty `department_id` and keeps its current target.

## Tests (24 Oct 2026, local, fictional data)

- 388 unit and integration tests passed (379 before, plus 9 new in `tests/integration/pm-department-plans.test.ts`): create and audit, enrolment, interval rules, hospital and department checks, department-limited manager, approved plan keeps its department, another organisation cannot use a Coastal department, the database refuses malformed targets, and the daily job creates a work order.
- Browser: the option appears, the department list follows the hospital, the hint is shown, and the saved plan shows "All assets in Intensive Care".
- Accessibility (axe, WCAG 2.1 AA): 0 violations on the plan form with the department option, at desktop and phone width.
- Lint, formatting, TypeScript, the production build and the migration safety check pass.

## Not done

- Automatic enrolment of assets added to a department later.
- Nothing is deployed. It needs a push to GitHub and a manual deploy on Render.
