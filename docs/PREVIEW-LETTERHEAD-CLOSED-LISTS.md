# Report preview, contact details and closed lists

## Preview before download

Every PDF or Excel button on a report now opens `/export-preview` first. The page shows the report as a PDF
and offers Download PDF and Download Excel. Excel previews as the PDF form of the same report, with a note.

- Only the three export routes can be previewed: `/reports/export`, `/assets/export`, `/maintenance/reports/export`.
  Any other address is refused.
- The preview loads the PDF with `inline=1`. Only those export paths allow being shown in a frame from the
  same site (`SAMEORIGIN`, `frame-ancestors 'self'`). Every other page still sends `DENY` and `frame-ancestors 'none'`.
- Known compromise: the preview fetch is audited as an export, so one download produces two audit entries.

## Contact details on reports

Set under User and Organization Administration, "Contact details on reports" (Org Admin only, permission
`logo.manage`). Address, telephone, email, website, registration number and a footer note. All optional.
They print beside the logo in the PDF header and in the first rows of the Excel file. Changes are audited
(`organization.letterhead_set`). Table: `organization_letterheads` (migration `20261025000300`).

## Closed lists

Technical Knowledge, Spare Parts Inventory, Work Orders and the PM run history stay closed until the person
searches, picks a view or filter, or follows "show the full list" (`?all=1`, or `?runs=1` for run history).
The shared component is `components/ui/closed-list.tsx`.
