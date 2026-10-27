# Removing a role, the audit log toggle and the centred report name (26 Oct 2026)

## Remove role

Organization Administrators see "Remove role" under each other member in User and Organization Administration.

- The membership is marked REVOKED, never deleted. Every job, test and record the person signed stays under their name.
- The person can no longer use that organisation. If they belong to another organisation, that access is unchanged.
- Nobody can remove their own role, and the last active Organization Administrator cannot be removed.
- Adding the same email again restores the person with the new role and access. Audit: `membership.revoked`, `membership.restored`.
- Permission: `member.remove` (Organization Administrator only). See PERMISSIONS.md.

## Audit log

Hidden by default. "Show audit log" reloads the page with `?audit=1`; "Hide audit log" returns. While hidden, the events are not even loaded.

## Reports

The organisation name and the report title are centred in the PDF header, between the logo and the contact block, and centred across the table width in Excel.

## Restoring archived hospitals and departments (27 Oct 2026)

- Archive buttons now ask "are you sure?" first.
- "Archived hospitals and departments" lists everything archived, with Restore buttons (Organization Administrator only, same permission as archiving).
- Restoring a hospital also brings back the departments archived at the same moment. A department archived on its own earlier stays archived until you restore it. A department cannot be restored while its hospital is archived.
- Audit: `hospital.restored`, `department.restored`.

## Administrator password reset (27 Oct 2026)

Under each member's email, an Organization Administrator sees "Reset password". They give a reason (how they confirmed who the person is) and get a new temporary password, shown once with a Copy button.

- The old password stops working immediately and the person is signed out everywhere. They should change the new one under Security.
- Never for yourself (use Security) and never for a platform administrator.
- Refused when the person also belongs to another organisation, because the login is shared; the platform team handles those.
- Audit: `auth.password_reset_by_admin` (reason recorded, never the password) and `auth.password_reset_refused`.
- Permission: `member.resetPassword` (Organization Administrator only). The Forgot-password page already tells people to ask their administrator.
