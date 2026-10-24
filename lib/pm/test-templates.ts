// Starting checklists for planned maintenance and safety tests, by equipment type.
//
// Different devices need different tests: an ECG monitor and a ventilator share
// the electrical safety checks but have different functional tests and values.
// These templates are STARTING POINTS only. They copy into a plan, where
// qualified staff edit, remove or add items before an Engineering Manager
// approves the plan. Limits are only filled in where they are common to the
// electrical safety standard used as default (IEC 62353); every other limit is
// left blank on purpose, to be set from the manufacturer's service manual or the
// organisation's verified standard. No measured value is ever generated.
import type { ChecklistItem } from "@/lib/validation/pm";

type Section = ChecklistItem["section"];

const VERIFY = "Set the limit from the manufacturer service manual or your verified standard.";

function check(key: string, label: string, section: Section, guidance: string | null = null): ChecklistItem {
  return { key, label, section, kind: "CHECK", required: true, unit: null, min: null, max: null, guidance };
}
function measure(
  key: string,
  label: string,
  section: Section,
  unit: string,
  limits: { min?: number; max?: number } = {},
  guidance: string | null = null,
): ChecklistItem {
  const hasLimit = limits.min !== undefined || limits.max !== undefined;
  return {
    key,
    label,
    section,
    kind: "MEASUREMENT",
    required: true,
    unit,
    min: limits.min ?? null,
    max: limits.max ?? null,
    guidance: guidance ?? (hasLimit ? "Check this limit against your verified standard." : VERIFY),
  };
}

/** Electrical safety checks common to mains-powered patient equipment (Class I). */
const ELECTRICAL: ChecklistItem[] = [
  check("es_visual", "Visual inspection of mains cable, plug and enclosure", "ELECTRICAL_SAFETY"),
  measure("es_pe", "Protective earth resistance", "ELECTRICAL_SAFETY", "Ω", { max: 0.3 }),
  measure("es_leak", "Equipment leakage current", "ELECTRICAL_SAFETY", "µA", { max: 500 }),
];
const patientLeakage = (label: string) =>
  measure(
    "es_patient",
    label,
    "ELECTRICAL_SAFETY",
    "µA",
    {},
    "Limit depends on the applied part type (B, BF or CF). " + VERIFY,
  );

export type TestTemplate = { id: string; name: string; description: string; items: ChecklistItem[] };

export const TEST_TEMPLATES: TestTemplate[] = [
  {
    id: "general",
    name: "General mains-powered device",
    description: "Inspection and electrical safety only. Add the functional tests for the device.",
    items: [
      check("insp_housing", "Enclosure, controls, labels and accessories undamaged", "INSPECTION"),
      ...ELECTRICAL,
      check("func_basic", "Functional test as per manufacturer procedure", "FUNCTIONAL"),
    ],
  },
  {
    id: "ecg-monitor",
    name: "ECG / patient monitor",
    description: "ECG, SpO2 and blood pressure checks against a patient simulator and NIBP tester.",
    items: [
      check("insp_leads", "ECG leads, cables, connectors and SpO2 probe undamaged", "INSPECTION"),
      check("insp_screen", "Display, keys and battery compartment undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (ECG applied part)"),
      measure("func_hr60", "Heart rate at 60 bpm simulator setting", "FUNCTIONAL", "bpm"),
      measure("func_hr120", "Heart rate at 120 bpm simulator setting", "FUNCTIONAL", "bpm"),
      check("func_ecgwave", "ECG waveform clean on all leads, no noise or baseline drift", "FUNCTIONAL"),
      measure("func_spo2", "SpO2 reading against simulator", "FUNCTIONAL", "%"),
      measure("func_nibp", "NIBP pressure against NIBP tester", "FUNCTIONAL", "mmHg"),
      check("func_alarms", "Alarms (high and low limits, lead off) work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges", "FUNCTIONAL"),
    ],
  },
  {
    id: "ventilator",
    name: "Ventilator",
    description: "Breathing delivery checks against a gas flow analyser, plus alarms and battery.",
    items: [
      check("insp_circuit", "Breathing circuit, filters, hoses and gas connections undamaged", "INSPECTION"),
      check("insp_housing", "Enclosure, display and controls undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part, if fitted)"),
      check("func_selftest", "Power-on self-test and circuit leak test pass", "FUNCTIONAL"),
      measure("func_vt", "Delivered tidal volume against flow analyser", "FUNCTIONAL", "mL"),
      measure("func_pressure", "Peak inspiratory pressure against analyser", "FUNCTIONAL", "cmH2O"),
      measure("func_peep", "PEEP against analyser", "FUNCTIONAL", "cmH2O"),
      measure("func_o2", "Delivered oxygen concentration", "FUNCTIONAL", "%"),
      measure("func_rate", "Respiratory rate", "FUNCTIONAL", "breaths/min"),
      check("func_alarms", "Alarms (high pressure, disconnect, low O2, power failure) work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges", "FUNCTIONAL"),
    ],
  },
  {
    id: "infusion-pump",
    name: "Infusion or syringe pump",
    description: "Flow accuracy and occlusion checks against an infusion device analyser.",
    items: [
      check("insp_housing", "Housing, door, clamp and keypad undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part, if fitted)"),
      measure("func_flow", "Flow rate accuracy at the test rate", "FUNCTIONAL", "%"),
      measure("func_occl", "Occlusion alarm pressure", "FUNCTIONAL", "mmHg"),
      check("func_air", "Air-in-line alarm works", "FUNCTIONAL"),
      check("func_alarms", "Door open, end of infusion and low battery alarms work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges", "FUNCTIONAL"),
    ],
  },
  {
    id: "defibrillator",
    name: "Defibrillator",
    description: "Energy delivery and charge time against a defibrillator analyser.",
    items: [
      check("insp_paddles", "Paddles or pads cable, connectors and housing undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part)"),
      measure("func_e50", "Delivered energy at 50 J setting", "FUNCTIONAL", "J"),
      measure("func_e200", "Delivered energy at 200 J setting", "FUNCTIONAL", "J"),
      measure("func_charge", "Charge time to the maximum energy", "FUNCTIONAL", "s"),
      check("func_ecg", "ECG display and rhythm recognition work", "FUNCTIONAL"),
      check("func_battery", "Battery holds charge and indicator is correct", "FUNCTIONAL"),
    ],
  },
];
