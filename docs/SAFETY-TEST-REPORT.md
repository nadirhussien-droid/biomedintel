# Safety test report, test equipment on jobs and test templates (24 Oct 2026)

## Which tool was used

A planned job or safety retest with electrical safety items asks, at sign-off, for the **test equipment used** (from Safety Tests and Calibration). It is required unless every electrical safety item is Not applicable. The tool must be in use and have a calibration on record that did not fail. An **overdue** calibration is allowed but marked in the form and printed on the report in capitals. (Repair jobs record a simple pass or fail and do not need a tool.) Stored in `work_orders.test_equipment_id`.

## Safety test report

Button **Safety test report** on a completed planned job with electrical safety results. Prints A4: organisation, device, asset ID and serial, location, date and tester, the standard and version, the tool used and the calibration in force on the day of the test (certificate number, laboratory, due date, and a warning if it had expired), every check by section with its limit, the measured value and result, the overall result, findings, next test due and sign-off. Measured values are only those entered by the technician; none are generated.

## Different equipment, different tests (templates)

An ECG monitor and a ventilator share the electrical safety checks but have different functional tests and values. When writing a maintenance plan, **Start from a template** offers: General mains-powered device, ECG / patient monitor, Ventilator, Infusion or syringe pump, Defibrillator. A template copies into the plan's checklist; staff then edit items and limits, and an Engineering Manager approves the plan as usual. Plans for a model or category keep their own checklist, so each device type has its own test report.

Only two limits are pre-filled (protective earth resistance 0.3 Ω and equipment leakage current 500 µA, as in the existing demo plans). Every other limit is blank on purpose and must be set from the manufacturer service manual or your verified standard. These are starting points, not a statement of what any standard requires.

## Not built yet

Blocking a test when the tool is overdue (currently allowed and flagged), reminders before a calibration is due, a report for non-planned jobs, saving your own templates, and the compliance summary report.
