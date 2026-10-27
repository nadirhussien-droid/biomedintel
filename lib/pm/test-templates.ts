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
  {
    id: "patient-monitor-nibp",
    name: "Blood pressure monitor (NIBP)",
    description: "Cuff pressure and leak checks against an NIBP tester.",
    items: [
      check("insp_cuff", "Cuff, hose and connectors undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_static", "Static pressure accuracy against NIBP tester", "FUNCTIONAL", "mmHg"),
      measure("func_leak", "Pneumatic leak rate", "FUNCTIONAL", "mmHg/min"),
      measure("func_overpressure", "Overpressure cut-out", "FUNCTIONAL", "mmHg"),
      check("func_alarms", "Alarms and display work", "FUNCTIONAL"),
    ],
  },
  {
    id: "pulse-oximeter",
    name: "Pulse oximeter",
    description: "SpO2 and pulse rate checks against a simulator.",
    items: [
      check("insp_probe", "Probe, cable and connectors undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part, if fitted)"),
      measure("func_spo2_97", "SpO2 against simulator at the high setting", "FUNCTIONAL", "%"),
      measure("func_spo2_85", "SpO2 against simulator at the low setting", "FUNCTIONAL", "%"),
      measure("func_pulse", "Pulse rate against simulator", "FUNCTIONAL", "bpm"),
      check("func_alarms", "Alarms work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges", "FUNCTIONAL"),
    ],
  },
  {
    id: "anaesthesia-machine",
    name: "Anaesthesia machine",
    description: "Gas delivery, vaporiser, ventilator and leak checks with a gas flow analyser.",
    items: [
      check("insp_gas", "Gas hoses, regulators, yokes and cylinders undamaged", "INSPECTION"),
      check("insp_circuit", "Breathing circuit, absorber and bellows undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part, if fitted)"),
      measure("func_leak", "Low-pressure system leak test", "FUNCTIONAL", "mL/min"),
      measure("func_circuit_leak", "Breathing system leak test", "FUNCTIONAL", "mL/min"),
      measure("func_vt", "Delivered tidal volume against analyser", "FUNCTIONAL", "mL"),
      measure("func_o2", "Oxygen concentration at the test setting", "FUNCTIONAL", "%"),
      measure("func_vap", "Vaporiser output against analyser", "FUNCTIONAL", "%"),
      check("func_o2_alarm", "Oxygen failure and low oxygen alarms work", "FUNCTIONAL"),
      check("func_alarms", "Pressure, disconnect and power failure alarms work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges", "FUNCTIONAL"),
    ],
  },
  {
    id: "suction-unit",
    name: "Suction unit",
    description: "Vacuum level and flow checks.",
    items: [
      check("insp_housing", "Housing, tubing, canister and filters undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_vacuum", "Maximum vacuum", "FUNCTIONAL", "mmHg"),
      measure("func_flow", "Free air flow", "FUNCTIONAL", "L/min"),
      check("func_overflow", "Overflow protection and bacterial filter work", "FUNCTIONAL"),
      check("func_battery", "Runs on battery and charges (if fitted)", "FUNCTIONAL"),
    ],
  },
  {
    id: "electrosurgical-unit",
    name: "Electrosurgical unit (diathermy)",
    description: "Output power, return electrode alarm and leakage against an ESU analyser.",
    items: [
      check("insp_leads", "Hand piece, foot switch, cables and return electrode connection undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part)"),
      measure("func_cut", "Output power in cut mode at the test load", "FUNCTIONAL", "W"),
      measure("func_coag", "Output power in coagulation mode at the test load", "FUNCTIONAL", "W"),
      measure("func_hf", "High frequency leakage current", "FUNCTIONAL", "mA"),
      check("func_rem", "Return electrode (patient plate) contact alarm works", "FUNCTIONAL"),
      check("func_tones", "Activation tones and indicators work", "FUNCTIONAL"),
    ],
  },
  {
    id: "infant-incubator",
    name: "Infant incubator or warmer",
    description: "Temperature control and alarm checks with a temperature probe.",
    items: [
      check("insp_housing", "Hood, portholes, mattress tray and seals undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_air", "Air temperature against reference probe", "FUNCTIONAL", "°C"),
      measure("func_skin", "Skin temperature probe accuracy", "FUNCTIONAL", "°C"),
      check("func_alarms", "Over-temperature, power failure and fan failure alarms work", "FUNCTIONAL"),
      check("func_scale", "Scale reads correctly (if fitted)", "FUNCTIONAL"),
    ],
  },
  {
    id: "sterilizer",
    name: "Steam sterilizer (autoclave)",
    description: "Temperature, pressure and cycle checks. Add the validation tests your standard requires.",
    items: [
      check("insp_door", "Door, gasket, chamber and drain strainer undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_temp", "Chamber temperature at the sterilising stage", "FUNCTIONAL", "°C"),
      measure("func_pressure", "Chamber pressure at the sterilising stage", "FUNCTIONAL", "kPa"),
      measure("func_time", "Sterilising hold time", "FUNCTIONAL", "min"),
      check("func_valve", "Safety valve and door interlock work", "FUNCTIONAL"),
      check("func_vacuum", "Vacuum or air-removal test passes (if fitted)", "FUNCTIONAL"),
      check("func_printout", "Cycle printout or record is correct", "FUNCTIONAL"),
    ],
  },
  {
    id: "ultrasound",
    name: "Ultrasound scanner",
    description: "Probe, image and electrical checks. Add image quality tests with a phantom if you have one.",
    items: [
      check("insp_probes", "Probes, cables, connectors and lenses undamaged", "INSPECTION"),
      check("insp_unit", "Screen, keyboard, trackball and wheels undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (probe applied part)"),
      check("func_image", "Image is clean on every probe, no dead elements or artefacts", "FUNCTIONAL"),
      check("func_controls", "Gain, depth, freeze and measurement tools work", "FUNCTIONAL"),
      check("func_print", "Printing, storage and export work", "FUNCTIONAL"),
    ],
  },
  {
    id: "xray-general",
    name: "General X-ray unit",
    description:
      "Mechanical, electrical and indicator checks. Radiation output tests need a qualified person and a dosimeter.",
    items: [
      check("insp_unit", "Tube head, stand, cables and collimator undamaged", "INSPECTION"),
      ...ELECTRICAL,
      check("func_collimator", "Collimator light and field size indicator work", "FUNCTIONAL"),
      check("func_indicators", "Exposure indicators, warning lights and tones work", "FUNCTIONAL"),
      check("func_interlock", "Door interlock and emergency stop work", "FUNCTIONAL"),
      measure("func_kvp", "Tube voltage accuracy against meter", "FUNCTIONAL", "kV"),
      measure("func_time", "Exposure time accuracy against meter", "FUNCTIONAL", "ms"),
      measure("func_output", "Radiation output at the test setting", "FUNCTIONAL", "mGy"),
    ],
  },
  {
    id: "oxygen-concentrator",
    name: "Oxygen concentrator",
    description: "Oxygen purity and flow checks.",
    items: [
      check("insp_housing", "Housing, filters, tubing and humidifier undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_purity", "Oxygen concentration at the test flow", "FUNCTIONAL", "%"),
      measure("func_flow", "Flow rate against flow meter", "FUNCTIONAL", "L/min"),
      measure("func_pressure", "Outlet pressure", "FUNCTIONAL", "kPa"),
      check("func_alarms", "Low oxygen, power failure and high temperature alarms work", "FUNCTIONAL"),
      measure("func_hours", "Running hours counter reading", "FUNCTIONAL", "h"),
    ],
  },
  {
    id: "dialysis-machine",
    name: "Haemodialysis machine",
    description: "Fluid path, temperature, conductivity and alarm checks.",
    items: [
      check("insp_housing", "Housing, hoses, connectors and blood pump cover undamaged", "INSPECTION"),
      ...ELECTRICAL,
      patientLeakage("Patient leakage current (applied part)"),
      measure("func_temp", "Dialysate temperature against reference", "FUNCTIONAL", "°C"),
      measure("func_cond", "Dialysate conductivity against reference", "FUNCTIONAL", "mS/cm"),
      measure("func_flow", "Dialysate flow rate", "FUNCTIONAL", "mL/min"),
      measure("func_pump", "Blood pump flow rate", "FUNCTIONAL", "mL/min"),
      check("func_leak", "Blood leak detector, air detector and venous pressure alarms work", "FUNCTIONAL"),
      check("func_disinfect", "Disinfection cycle completes", "FUNCTIONAL"),
    ],
  },
  {
    id: "centrifuge",
    name: "Laboratory centrifuge",
    description: "Speed, timer and safety interlock checks.",
    items: [
      check("insp_rotor", "Rotor, buckets, lid and seals undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_speed", "Rotor speed against tachometer", "FUNCTIONAL", "rpm"),
      measure("func_timer", "Timer accuracy", "FUNCTIONAL", "min"),
      check("func_lid", "Lid lock and imbalance cut-out work", "FUNCTIONAL"),
      check("func_brake", "Brake and stopping time are normal", "FUNCTIONAL"),
    ],
  },
  {
    id: "phototherapy",
    name: "Phototherapy unit",
    description: "Light output check with an irradiance meter.",
    items: [
      check("insp_housing", "Housing, lamps and stand undamaged", "INSPECTION"),
      ...ELECTRICAL,
      measure("func_irradiance", "Irradiance at the mattress", "FUNCTIONAL", "µW/cm²/nm"),
      check("func_timer", "Timer and indicators work", "FUNCTIONAL"),
      measure("func_hours", "Lamp hours counter reading", "FUNCTIONAL", "h"),
    ],
  },
  {
    id: "patient-hoist",
    name: "Patient hoist or lifter",
    description: "Mechanical and electrical checks for ceiling and mobile hoists. Load tests need your standard.",
    items: [
      check("insp_frame", "Frame, boom, spreader bar and castors undamaged", "INSPECTION"),
      check("insp_sling", "Sling, straps and hooks undamaged", "INSPECTION"),
      ...ELECTRICAL,
      check("func_lift", "Lifts and lowers smoothly through the full range", "FUNCTIONAL"),
      check("func_stop", "Emergency stop and emergency lowering work", "FUNCTIONAL"),
      measure("func_load", "Safe working load check, if your procedure includes it", "FUNCTIONAL", "kg"),
      check("func_battery", "Battery holds charge and indicator is correct", "FUNCTIONAL"),
    ],
  },
  {
    id: "electric-bed",
    name: "Electric hospital or aged care bed",
    description: "Movement, safety and electrical checks for powered beds.",
    items: [
      check("insp_frame", "Frame, rails, mattress platform and castors undamaged", "INSPECTION"),
      ...ELECTRICAL,
      check("func_height", "Height, backrest and leg movement work smoothly", "FUNCTIONAL"),
      check("func_rails", "Side rails latch and hold", "FUNCTIONAL"),
      check("func_handset", "Hand control and lockout work", "FUNCTIONAL"),
      check("func_brakes", "Brakes hold", "FUNCTIONAL"),
      check("func_battery", "Backup battery works (if fitted)", "FUNCTIONAL"),
    ],
  },
  {
    id: "dental-unit",
    name: "Dental chair and unit",
    description: "Chair movement, handpiece air and water, suction and light checks.",
    items: [
      check("insp_chair", "Chair, upholstery, arm and foot control undamaged", "INSPECTION"),
      check("insp_handpieces", "Handpiece tubing, couplings and syringe undamaged", "INSPECTION"),
      ...ELECTRICAL,
      check("func_chair", "Chair raises, lowers and tilts, safety stop works", "FUNCTIONAL"),
      measure("func_air", "Handpiece air pressure", "FUNCTIONAL", "kPa"),
      measure("func_water", "Water flow at the handpiece", "FUNCTIONAL", "mL/min"),
      check("func_suction", "Suction is strong at both hoses", "FUNCTIONAL"),
      check("func_light", "Operating light works at all settings", "FUNCTIONAL"),
      check("func_bottle", "Water bottle, valves and waterline treatment in order", "FUNCTIONAL"),
    ],
  },
];
