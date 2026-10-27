# Checklist templates (27 Oct 2026)

Preventive Maintenance → **Templates**.

- **Starter templates:** 21 ready-made checklists for common devices (general, ECG monitor, ventilator, infusion pump, defibrillator, NIBP, pulse oximeter, anaesthesia machine, suction, electrosurgical unit, incubator, sterilizer, ultrasound, X-ray, oxygen concentrator, dialysis machine, centrifuge, phototherapy, patient hoist, electric bed, dental unit). They leave almost every limit blank on purpose: set limits from the manufacturer service manual or your verified standard. Only the two common electrical safety limits (earth resistance, equipment leakage) are pre-filled. No measured value is ever generated.
- **Your saved templates:** Engineering Managers and Organization Administrators can create, copy from a starter, edit, archive and restore their own (name, optional device type, notes, list of checks with Pass/Fail or measurement and limits). Names are unique (capitals ignored). Archiving never deletes; plans already made keep their own checklist.
- **Using a template:** the plan form lists "Your saved templates" and "Starter templates". Picking one fills the checklist; the plan still needs an Engineering Manager's approval before it creates any work.
- Everyone with maintenance access can see the templates; only managers can change them.
- Audit: `pm.template_created`, `pm.template_updated`, `pm.template_archived`, `pm.template_restored`.
- Database: table `checklist_templates` (migration `20261027000100`), row-level security per organisation, no delete.
