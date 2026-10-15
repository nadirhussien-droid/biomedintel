// Fictional preventive maintenance setup for development (Stage 6).
//
// FICTIONAL DEMONSTRATION DATA. The test standards are real standard NAMES,
// but the seeded "verification", the limits in the checklists and every
// manufacturer document reference are invented for the demo. Qualified
// biomedical engineering staff must verify real procedures and limits before
// use. Nothing here describes a real device or a real service manual.
//
// Plans and schedules only: no PM work orders are seeded. Run
// `npm run pm:generate` after seeding to watch the scheduler create them.
import type { Prisma, PrismaClient } from "../server/db/generated/client";
import { addDays, dueDate, localToday, toDbDate } from "../lib/pm/dates";

type Item = {
  key: string;
  label: string;
  section: "INSPECTION" | "FUNCTIONAL" | "SERVICING" | "ELECTRICAL_SAFETY";
  kind?: "CHECK" | "MEASUREMENT";
  unit?: string;
  min?: number;
  max?: number;
  guidance?: string;
};

const DEMO_LIMIT = "Demo limit — verify against the applicable standard and manufacturer instructions.";

const item = (i: Item) => ({
  key: i.key,
  label: i.label,
  section: i.section,
  kind: i.kind ?? "CHECK",
  required: true,
  unit: i.unit ?? null,
  min: i.min ?? null,
  max: i.max ?? null,
  guidance: i.guidance ?? null,
});

const ELECTRICAL_SAFETY: Item[] = [
  { key: "es_visual", label: "Visual inspection of mains cable, plug and enclosure", section: "ELECTRICAL_SAFETY" },
  {
    key: "es_pe",
    label: "Protective earth resistance",
    section: "ELECTRICAL_SAFETY",
    kind: "MEASUREMENT",
    unit: "Ω",
    max: 0.3,
    guidance: DEMO_LIMIT,
  },
  {
    key: "es_leak",
    label: "Equipment leakage current",
    section: "ELECTRICAL_SAFETY",
    kind: "MEASUREMENT",
    unit: "µA",
    max: 500,
    guidance: DEMO_LIMIT,
  },
];

const PLANS = {
  infusion: {
    name: "Infusion pump annual PM and safety test",
    workType: "PREVENTIVE" as const,
    target: "INF",
    interval: [12, "MONTH"] as const,
    source: "MANUFACTURER" as const,
    reference: "DM-Infuse 100 service manual (demo), section 6",
    priority: "HIGH" as const,
    minutes: 60,
    competency: "Infusion device servicing (demo course)",
    instructions: "Follow the manufacturer PM procedure. Use the organisation's calibrated safety analyser.",
    checklist: [
      { key: "insp_housing", label: "Housing, door and keypad undamaged", section: "INSPECTION" as const },
      { key: "func_alarm", label: "Occlusion and air-in-line alarms work", section: "FUNCTIONAL" as const },
      {
        key: "func_rate",
        label: "Flow rate accuracy at 100 mL/h",
        section: "FUNCTIONAL" as const,
        kind: "MEASUREMENT" as const,
        unit: "%",
        min: -5,
        max: 5,
        guidance: DEMO_LIMIT,
      },
      { key: "serv_clean", label: "Cleaned; battery condition checked", section: "SERVICING" as const },
      ...ELECTRICAL_SAFETY,
    ],
  },
  defib: {
    name: "Defibrillator 6-monthly PM and safety test",
    workType: "PREVENTIVE" as const,
    target: "DEF",
    interval: [6, "MONTH"] as const,
    source: "MANUFACTURER" as const,
    reference: "SC-Shock 2 service manual (demo), section 4",
    priority: "HIGH" as const,
    minutes: 45,
    competency: "Defibrillator testing (demo course)",
    instructions: "Test energy delivery with the defibrillator analyser. Never test on a person.",
    checklist: [
      {
        key: "insp_pads",
        label: "Pads/paddles, cables and battery in date and undamaged",
        section: "INSPECTION" as const,
      },
      {
        key: "func_energy",
        label: "Delivered energy at 200 J setting",
        section: "FUNCTIONAL" as const,
        kind: "MEASUREMENT" as const,
        unit: "J",
        min: 170,
        max: 230,
        guidance: DEMO_LIMIT,
      },
      { key: "func_selftest", label: "Self-test passes", section: "FUNCTIONAL" as const },
      ...ELECTRICAL_SAFETY,
    ],
  },
  ventilator: {
    name: "Ventilator quarterly inspection",
    workType: "INSPECTION" as const,
    target: "Ventilator",
    interval: [3, "MONTH"] as const,
    source: "ORGANIZATIONAL_REQUIREMENT" as const,
    reference: "Coastal Health biomedical policy BME-07 (fictional), clause 3.2",
    priority: "HIGH" as const,
    minutes: 30,
    competency: null,
    instructions: "Visual and functional inspection between full manufacturer services.",
    checklist: [
      { key: "insp_circuit", label: "Breathing circuit connections and filters", section: "INSPECTION" as const },
      { key: "func_alarms", label: "High-pressure and disconnect alarms work", section: "FUNCTIONAL" as const },
    ],
  },
};

export async function seedPreventiveMaintenance(
  db: PrismaClient,
  organizationId: string,
  slug: string,
  users: Map<string, string>,
) {
  const hospitals = await db.hospital.findMany({ where: { organizationId }, select: { id: true, code: true } });
  const hospital = (code: string) => hospitals.find((h) => h.code === code)!.id;
  const iec = await db.testStandard.create({
    data: {
      organizationId,
      code: "IEC 62353",
      version: "Ed. 2.0 (2014)",
      title: "Medical electrical equipment — Recurrent test and test after repair of medical electrical equipment",
      jurisdictionNote: "Default standard (decision of 15 Oct 2026). Confirm local legal requirements.",
    },
  });
  await db.testStandard.create({
    data: {
      organizationId,
      code: "AS/NZS 3551",
      version: "2012",
      title: "Management programs for medical equipment",
      jurisdictionNote: "Australia and New Zealand",
    },
  });
  await db.testStandardRule.create({ data: { organizationId, standardId: iec.id } });

  if (slug === "highland-medical") {
    // Highland has no Engineering Manager yet, so its standard stays unverified
    // and its plan stays a draft: nothing is generated until someone qualified approves.
    const cat = await db.equipmentCategory.findFirstOrThrow({ where: { organizationId, name: "Ventilator" } });
    await db.maintenancePlan.create({
      data: {
        organizationId,
        name: "Ventilator quarterly inspection (draft)",
        workType: "INSPECTION",
        targetKind: "CATEGORY",
        categoryId: cat.id,
        intervalCount: 3,
        intervalUnit: "MONTH",
        intervalSource: "ORGANIZATIONAL_REQUIREMENT",
        sourceReference: "Highland Medical engineering policy (fictional) — awaiting confirmation",
        startsOn: toDbDate(localToday("Africa/Kampala")),
        checklist: [item(PLANS.ventilator.checklist[0]), item(PLANS.ventilator.checklist[1])],
        createdById: users.get("david.mutua@highland.example")!,
      },
    });
    return;
  }

  const james = users.get("james.otieno@coastal.example")!;
  const hodan = users.get("hodan.ali@coastal.example")!;
  const amina = users.get("amina.warsame@coastal.example")!;
  await db.testStandard.update({
    where: { id: iec.id },
    data: {
      verifiedById: james,
      verifiedAt: new Date(),
      verificationNote: "Fictional seed: test procedure and limits checked against our test instructions (demo).",
    },
  });

  const models = await db.equipmentModel.findMany({ where: { organizationId }, select: { id: true, modelName: true } });
  const model = (name: string) => models.find((m) => m.modelName === name)!.id;
  const intervals: [string, number, "MONTH", string][] = [
    ["DM-Infuse 100", 12, "MONTH", PLANS.infusion.reference],
    ["SC-Shock 2", 6, "MONTH", PLANS.defib.reference],
    ["EB-Vitals 5", 12, "MONTH", "EB-Vitals 5 service manual (demo), chapter 8"],
  ];
  for (const [name, count, unit, reference] of intervals) {
    await db.equipmentModel.update({
      where: { id: model(name) },
      data: {
        manufacturerPmIntervalCount: count,
        manufacturerPmIntervalUnit: unit,
        manufacturerPmReference: reference,
      },
    });
  }

  const today = localToday("Africa/Nairobi");
  const assetId = async (tag: string) =>
    (await db.asset.findFirstOrThrow({ where: { organizationId, assetTag: tag }, select: { id: true } })).id;
  const ventCategory = await db.equipmentCategory.findFirstOrThrow({ where: { organizationId, name: "Ventilator" } });

  async function approvedPlan(
    p: (typeof PLANS)[keyof typeof PLANS],
    target: Prisma.MaintenancePlanUncheckedCreateInput,
  ) {
    const checklist = p.checklist.map(item);
    const plan = await db.maintenancePlan.create({ data: { ...target, checklist } });
    const rev = await db.maintenancePlanRevision.create({
      data: {
        organizationId,
        planId: plan.id,
        revisionNo: 1,
        kind: "APPROVAL",
        intervalCount: p.interval[0],
        intervalUnit: p.interval[1],
        intervalSource: p.source,
        sourceReference: p.reference,
        checklist,
        snapshot: {
          name: p.name,
          description: null,
          workType: p.workType,
          targetKind: target.targetKind,
          hospitalId: target.hospitalId ?? null,
          startsOn: addDays(today, -120),
          endsOn: null,
          leadDays: 14,
          graceDays: 7,
          estimatedMinutes: p.minutes,
          defaultAssigneeId: target.defaultAssigneeId ?? null,
          requiredCompetency: p.competency,
          priority: p.priority,
          documentReference: p.reference,
          instructions: p.instructions,
        },
        effectiveFrom: toDbDate(addDays(today, -120)),
        approvedById: james,
        note: "Fictional seed approval.",
      },
    });
    await db.maintenancePlan.update({
      where: { id: plan.id },
      data: { approvedRevisionId: rev.id, status: "ACTIVE", hasUnapprovedChanges: false },
    });
    return plan;
  }

  const common = (p: (typeof PLANS)[keyof typeof PLANS]) => ({
    organizationId,
    name: p.name,
    workType: p.workType,
    intervalCount: p.interval[0],
    intervalUnit: p.interval[1],
    intervalSource: p.source,
    sourceReference: p.reference,
    startsOn: toDbDate(addDays(today, -120)),
    leadDays: 14,
    graceDays: 7,
    estimatedMinutes: p.minutes,
    requiredCompetency: p.competency,
    priority: p.priority,
    documentReference: p.reference,
    instructions: p.instructions,
    nextReviewOn: toDbDate(addDays(today, 245)),
    createdById: hodan,
    updatedById: james,
    checklist: [],
  });

  const infusion = await approvedPlan(PLANS.infusion, {
    ...common(PLANS.infusion),
    targetKind: "MODEL",
    modelId: model("DM-Infuse 100"),
    defaultAssigneeId: amina,
  });
  const defib = await approvedPlan(PLANS.defib, {
    ...common(PLANS.defib),
    targetKind: "MODEL",
    modelId: model("SC-Shock 2"),
  });
  const vent = await approvedPlan(PLANS.ventilator, {
    ...common(PLANS.ventilator),
    targetKind: "CATEGORY",
    categoryId: ventCategory.id,
    hospitalId: hospital("RGH"),
  });

  // A draft with an organisation-defined interval (no manufacturer guidance for this model).
  await db.maintenancePlan.create({
    data: {
      organizationId,
      name: "Suction unit 6-monthly check",
      workType: "PREVENTIVE",
      targetKind: "MODEL",
      modelId: model("DM-Suction S"),
      intervalCount: 6,
      intervalUnit: "MONTH",
      intervalSource: "ORGANIZATION_DEFINED",
      justification:
        "No manufacturer interval is available for this demo model; six months chosen from local fault history (fictional).",
      startsOn: toDbDate(today),
      checklist: [
        item({ key: "func_vacuum", label: "Maximum vacuum reached", section: "FUNCTIONAL" }),
        item({ key: "serv_clean", label: "Canister and tubing cleaned or replaced", section: "SERVICING" }),
      ],
      createdById: james,
    },
  });

  // Schedules with first due dates around today, so the first run shows every state:
  // overdue, due today, upcoming (inside the lead time), later, and a missed catch-up.
  const enrol = async (planId: string, tag: string, workType: "PREVENTIVE" | "INSPECTION", offsetDays: number) => {
    const anchor = addDays(today, offsetDays);
    await db.pmSchedule.create({
      data: {
        organizationId,
        planId,
        assetId: await assetId(tag),
        workType,
        anchorOn: toDbDate(anchor),
        nextSeq: 0,
        nextDueOn: toDbDate(dueDate(anchor, "MONTH", 1, 0)),
        createdById: james,
      },
    });
  };
  await enrol(infusion.id, "INF-0001", "PREVENTIVE", -20); // overdue
  await enrol(infusion.id, "INF-0003", "PREVENTIVE", 0); // due today
  await enrol(infusion.id, "INF-0101", "PREVENTIVE", 10); // inside the 14-day lead time
  await enrol(infusion.id, "INF-0002", "PREVENTIVE", 60); // later
  await enrol(defib.id, "DEF-0001", "PREVENTIVE", 5);
  await enrol(defib.id, "DEF-0101", "PREVENTIVE", 40);
  await enrol(vent.id, "VEN-0001", "INSPECTION", -100); // one missed quarter, then overdue
}
