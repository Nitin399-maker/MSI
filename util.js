// ========== MEDICAL ANALYSIS PROMPT ==========
export const MEDICAL_ANALYSIS_PROMPT = `CRITICAL INSTRUCTIONS FOR COUNTS:
- Count ONLY the actual entries you create in the arrays
- surgeriesTotal MUST equal the exact number of items in the "surgeries" array
- concussionsTotal MUST equal the exact number of items in the "neuro.concussions" array
- majorInjuriesTotal MUST equal the count of injuries with severity="Major" in the "injuries" array
- moderateInjuriesTotal MUST equal the count of injuries with severity="Moderate" in the "injuries" array
- minorInjuriesTotal MUST equal the count of injuries with severity="Minor" in the "injuries" array
- missedGamesTotal should be the sum of all missedGames from the "availability.missedGamesBySeason" array
- DO NOT inflate counts - they must match the actual array lengths
- CRITICAL: For all date fields, NEVER use "00" for unknown month or day. If only the year is known, use "YYYY-01-01". If the year and month are known but not the day, use the first day of that month (e.g., "YYYY-MM-01"). Never produce dates like "2017-00-00" or "2017-05-00".
CRITICAL DISTINCTION - Clinical Injuries vs Incidental Findings:
- Include in "injuries" array ONLY injuries that were clinically diagnosed and discussed by the examining physician
- Do NOT include incidental imaging findings unless they were the reason for the exam or resulted in treatment/time loss
- Incidental findings (e.g., mild tendinosis or tendinopathy noted on MRI but not discussed, old healed injuries, asymptomatic anatomical variants) should be recorded in "imagingFindings" instead
- If an MRI finding led to treatment, time loss, or was specifically addressed by the physician, then it qualifies as a clinical injury

Extract and return ONLY a valid JSON object with the following structure (no markdown, no code blocks, just raw JSON):
{
  "player": {
    "name": "string",
    "draftYear": 2022,
    "handedness": "L|R|Unknown"
  },
  "summaryCounts": {
    "surgeriesTotal": 0,
    "surgeriesMajorJoint": 0,
    "surgeriesNonMajorJoint": 0,
    "recurrenceTotal": 0,
    "missedGamesTotal": 0,
    "concussionsTotal": 0,
    "cervicalNeurologicEventsTotal": 0,
    "majorInjuriesTotal": 0,
    "moderateInjuriesTotal": 0,
    "minorInjuriesTotal": 0
  },
  "flags": {
    "cartilageDegeneration": "None|Mild|Moderate|Severe|Full",
    "looseBodies": false,
    "effusionRecurrentOrModerate": false,
    "osteoarthritisOrArthrosis": false,
    "stressFractureHistory": false,
    "fractureNonunionOrDelayedUnion": false,
    "avascularNecrosisConcern": false,
    "hardwareFailureOrBrokenImplant": false,
    "recurrentInstability": false,
    "recurrentMuscleStrain": false,
    "kineticChainMuscleStrain": false,
    "recurrentMuscleStrainDifferentMuscle": false
  },
  "availability": {
    "missedGamesBySeason": [
      { "season": 2022, "missedGames": 0, "gamesPlayed": 0, "missedPracticeWeeks": 0, "reason": "string" }
    ],
    "missedPracticeWeeksTotal": 0,
    "limitedParticipationWeeksTotal": 0,
    "currentRestrictions": "None|Limited|NoCombine|ProDayOnly|Unknown",
    "availabilityNarrative": "string"
  },
  "injuries": [
    {
      "date": "YYYY-MM-DD",
      "season": 2024,
      "bodyRegion": "Head|CervicalSpine|Shoulder|Elbow|WristHand|HipGroin|ThighHamstring|Knee|AnkleFoot|LumbarSpine|Spine|Hip|GreatToe|Other",
      "structure": "string (e.g., MCL, labrum, meniscus)",
      "injuryName": "string",
      "type": "Sprain|Strain|Tear|Fracture|Dislocation|Subluxation|tendinopathy|Contusion|Other",
      "typeReason": "Brief explanation of why this type was chosen (2-3 sentences)",
      "typeSourceDoc": "Document filename where type information was found",
      "typeSourceQuote": "Exact sentence or phrase from document supporting this type classification",
      "side": "Left|Right|Bilateral|NA",
      "severity": "Major|Moderate|Minor",
      "severityReason": "Brief explanation of why this severity level was assigned based on impact, time lost, structural damage, or career implications (2-3 sentences)",
      "severitySourceDoc": "Document filename where severity information was found",
      "severitySourceQuote": "Exact sentence or phrase from document supporting this severity classification",
      "mechanism": "Contact|NonContact|Overuse|Unknown",
      "recurrenceGroupId": "string-or-null",
      "treatment": {
        "surgery": false,
        "injection": "None|PRP|Cortisone|Other|Unknown",
        "braceOrTape": false,
        "rehabOnly": true
      },
      "timeLost": {
        "missedGames": 0,
        "missedPracticeWeeks": 0
      },
      "currentStatus": "Asymptomatic|Symptomatic|Recovered|Ongoing|Unknown",
      "statusReason": "Brief explanation of current status based on documented recovery, symptoms, or limitations (2-3 sentences)",
      "statusSourceDoc": "Document filename where status information was found",
      "statusSourceQuote": "Exact sentence or phrase from document supporting this status",
      "clinicalSummary": "1-2 concise sentences summarizing this injury as a physician would: what happened, key structural findings from imaging if any, treatment, and current status. Write in plain clinical language suitable for a medical report.",
      "notes": "string"
    }
  ],
  "surgeries": [
    {
      "date": "YYYY-MM-DD",
      "bodyRegion": "Head|CervicalSpine|Shoulder|Elbow|WristHand|HipGroin|ThighHamstring|Knee|AnkleFoot|LumbarSpine|Spine|Hip|GreatToe|Other",
      "procedure": "string",
      "procedureCategory": "Repair|Reconstruction|Arthroscopy|Medial Meniscectomy|Lateral Meniscectomy| High-Volume Meniscectomy (>50%)|ORIF|Tendon Debridement|Aspiration and/or Injection|Other",
      "procedureCategoryReason": "Brief explanation of why this procedure category was chosen based on the surgical technique and intervention type (2-3 sentences)",
      "procedureCategorySourceDoc": "Document filename where procedure information was found",
      "procedureCategorySourceQuote": "Exact sentence or phrase from document describing the procedure",
      "side": "Left|Right|Bilateral|NA",
      "majorJoint": true,
      "revision": false,
      "revisionCount": 0,
      "reasonRelatedInjuryId": "optional reference",
      "clinicalSummary": "1-2 concise sentences summarizing this procedure as a physician would: the indication, what was done, and the outcome/recovery status. Write in plain clinical language suitable for a medical report.",
      "outcome": {
        "returnedToPlay": true,
        "residualSymptoms": "None|Mild|Moderate|Severe|Unknown",
        "outcomeReason": "Brief explanation of the outcome assessment based on recovery progress, return to play status, and any documented limitations (2-3 sentences)",
        "outcomeSourceDoc": "Document filename where outcome information was found",
        "outcomeSourceQuote": "Exact sentence or phrase from document describing the outcome",
        "currentLimitation": "None|WeightRoomMods|Brace|SnapCount|Unknown"
      }
    }
  ],
  "imagingFindings": [
    {
      "date": "YYYY-MM-DD",
      "modality": "MRI|XR|CT|US|Other",
      "bodyRegion": "Head|CervicalSpine|Shoulder|Elbow|WristHand|HipGroin|ThighHamstring|Knee|AnkleFoot|LumbarSpine|Spine|Hip|GreatToe|Other",
      "side": "Left|Right|Bilateral|NA",
      "sourceDoc": "string",
      "structuredFindings": {
        "degenerativeChange": "None|Mild|Moderate|Severe|Unknown",
        "cartilageDamage": "None|Mild|Moderate|Severe|FullThickness|Unknown",
        "labrumMeniscusStatus": "Normal|PostOpNoRetear|PossibleRetear|ConfirmedRetear|Unknown",
        "tendonStatus": "Normal|Tendinosis or tendinopathy|PartialTear|FullTear|Unknown",
        "ligamentStatus": "Normal|SprainLowGrade|SprainGrade2|Tear|ReconstructionIntact|Unknown",
        "effusion": "None|Trace|Moderate|Large|Unknown",
        "looseBodies": false,
        "nonunionOrDelayedUnion": false,
        "avascularNecrosisConcern": false,
        "hardwareComplication": "None|Lucency|Broken|Migration|Unknown",
        "postTraumaticArthritis": false,
        "stressReactionOrFracture": false
      },
      "imaging": {
        "finding": "finding description",
        "date": "YYYY-MM-DD",
        "doc": "source document name"
      }
    }
  ],
  "neuro": {
    "concussions": [
      {
        "date": "YYYY-MM-DD",
        "lossOfConsciousness": false,
        "timeLostDays": 0,
        "missedGames": 0,
        "prolongedSymptoms": false
      }
    ],
    "cervicalEvents": [
      {
        "date": "YYYY-MM-DD",
        "eventType": "Stinger|Radiculopathy|Neurapraxia|Other",
        "recurrent": false,
        "timeLostGames": 0,
        "currentSymptoms": false
      }
    ]
  },
  "timeline": [
    {"year": 2024, "event": "event description"}
  ],
  "scoringInputs": {
    "lastSignificantEventDate": "YYYY-MM-DD",
    "monthsSinceLastSignificantEvent": 0,
    "structuralRedFlagCount": 0,
    "degenerativeBurdenScore": 0,
    "instabilityBurdenScore": 0
  },
  "generalHealth": [
    {
      "condition": "string (exact condition name, e.g., ADHD, Diabetes, Seizure Disorder)",
      "status": "Active|Controlled|Resolved|Negative",
      "notes": "string (brief clinical note, e.g., 'managed with medication', 'history of, no current treatment')"
    }
  ]
}

CRITICAL INSTRUCTIONS FOR generalHealth (MMI) EXTRACTION:
Populate the "generalHealth" array by scanning ALL documents for the conditions listed below.
For each condition found, record the exact condition name, its current status (Active/Controlled/Resolved/Negative), and a brief note.
Only include conditions that are explicitly mentioned in the documents. Do NOT fabricate conditions.
If a condition is described as 'history of', 'denies', 'resolved', 'negative', or 'no current', set status to 'Resolved' or 'Negative'.
If a condition is currently present, being treated, or requires monitoring, set status to 'Active' or 'Controlled'.

HIGH RISK CONDITIONS to look for (10 pts each if Active/Controlled):
- Major depressive disorder combined with ADHD and multiple concussion history
- Any diagnosed significant psychiatric disorder that isn't ADHD/anxiety/depression (e.g., Schizophrenia, Bipolar Disorder, Psychosis)
- History of cardiac arrhythmia
- Diagnosed clotting / bleeding disorder other than low platelet count (e.g., Hemophilia, Coagulopathy)
- Migraines combined with multiple concussion history
- Substance abuse / Substance use disorder
- Seizure disorder / Epilepsy
- Post-concussive syndrome
- Transient quadriplegia
- Diagnosed Marfan syndrome
- Ehlers-Danlos Syndrome
- Diagnosed Rheumatologic condition (e.g., Rheumatoid Arthritis, Lupus, Ankylosing Spondylitis)

MODERATE RISK CONDITIONS to look for (5 pts each if Active/Controlled):
- ADHD / Attention Deficit Disorder
- Depression / Depressive disorder (without psychiatric comorbidities)
- Hypertension / High blood pressure
- Diabetes / Elevated glucose / Abnormal fasting glucose / Pre-diabetes
- Migraines (especially when combined with history of concussions)
- Hepatitis (any type)
- Asthma (active or requiring medication)
- Hearing loss
- History of DVT / Deep vein thrombosis
- History of Gout with recurrent episodes or on allopurinol
- History of rhabdomyolysis due to heat illness
- Low platelet count / Thrombocytopenia
- History of GI bleed / Gastrointestinal bleed
- Chronic Regional Pain syndrome / CRPS
- Peripheral nerve injury
- History of vision disorder or eye surgery other than LASIK
- Untreated sleep apnea or diagnosed sleep disorder

MINOR RISK CONDITIONS to look for (2 pts each if Active/Controlled):
- Mild, intermittent asthma / bronchospasm
- 2+ mTBI / Multiple mild traumatic brain injuries
- Anemia
- Sickle cell trait
- Solitary organ (e.g., solitary kidney, solitary testicle)
- Gout, controlled (no recurrent episodes, not on allopurinol)

Important: 
- Combine and deduplicate information from all documents
- Return ONLY the JSON object, no additional text or formatting
- Ensure all arrays contain unique entries (no duplicates)
- Use the exact enum values specified (e.g., "Major" not "major")
- Fill in all required fields with best estimates from documents
- CRITICAL: Ensure summaryCounts values match the actual array lengths (e.g., surgeriesTotal = surgeries.length)
- Set flags to true ONLY when there is clear evidence in the imaging findings or medical history
- Must and must return the valid json`;

// ========== MEDICAL SCORE CALCULATION ==========
function clamp(x, min, max) {
    return Math.max(min, Math.min(max, x));
}

function monthsBetween(dateStrA, dateStrB) {
    if (!dateStrA || !dateStrB) return 0;
    const a = new Date(dateStrA);
    const b = new Date(dateStrB);
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    return Math.max(0, months);
}

function decay(monthsAgo, halfLife) {
    if (halfLife <= 0) return 1;
    if (isNaN(monthsAgo) || monthsAgo < 0) return 1;
    const result = Math.pow(0.5, monthsAgo / halfLife);
    return isNaN(result) ? 1 : result;
}

// Change 1 (scoring side): Accept "severe" as alias for "major" and "mild" as alias for "minor"
function sevWeight(sev) {
    switch ((sev || "").toLowerCase()) {
        case "major":
        case "severe": return 4.5;
        case "moderate": return 2.5;
        case "minor":
        case "mild": return 1;
        default: return 0;
    }
}

// Change 2: typeMultiplier now accepts monthsAgo for fracture time-based multiplier:
//   fracture <=24 months from base date => 1.3x; fracture >24 months => 1.05x
function typeMultiplier(type, monthsAgo) {
    const t = (type || "").toLowerCase();
    if (t === "fracture") return (monthsAgo !== undefined && monthsAgo <= 24) ? 1.3 : 1.05;
    if (t === "dislocation" || t === "subluxation") return 1.25;
    if (t === "tear") return 1.25;
    if (t === "sprain") return 1.05;
    if (t === "strain") return 1.0;
    if (t === "tendinopathy") return 0.95;
    if (t === "contusion") return 0.8;
    return 0;
}

// Changes 3, 4, 5: procedureMultiplier now accepts monthsAgo for ORIF time-based multiplier:
//   ORIF <=12 months from base date => 1.25x; ORIF >12 months => 1.0x.
//   Added: Medial Meniscectomy (1.0x), Lateral Meniscectomy High-Volume (1.2x),
//   Meniscectomy (>50%) (1.3x), Aspiration and/or Injection (count-based, handled at call site).
function procedureMultiplier(cat, monthsAgo) {
    const c = (cat || "").toLowerCase().trim();
    if (c === "reconstruction") return 1.25;
    // Change 3: ORIF multiplier is time-based
    if (c === "orif") return (monthsAgo !== undefined && monthsAgo <= 12) ? 1.25 : 1.1;
    if (c === "repair") return 1.2;
    // Change 4: new meniscectomy sub-categories
    if (c === "lateral meniscectomy") return 1.2;
    if (c === "high-volume meniscectomy (>50%)") return 1.3;
    if (c === "medial meniscectomy" || c === "meniscectomy") return 1.0;
    if (c === "arthroscopy") return 0.9;
    if (c === "tendon debridement") return 0.85;
    // Change 5: Aspiration and/or Injection multiplier is count-based (handled at call site)
    if (c === "aspiration and/or injection") return null; // sentinel: handled separately
    return 0;
}

function residualPenalty(level) {
    switch ((level || "").toLowerCase()) {
        case "none": return 0;
        case "mild": return 1;
        case "moderate": return 2.5;
        case "severe": return 4;
        default: return 0;
    }
}

function limitationPenalty(lim) {
    switch ((lim || "").toLowerCase()) {
        case "none": return 0;
        case "weightroommods": return 1;
        case "brace": return 1.5;
        case "snapcount": return 2;
        default: return 0;
    }
}

function cartilagePenalty(level) {
    const v = (level || "").toLowerCase();
    if (v === "fullthickness") return 5;
    if (v === "severe") return 3.5;
    if (v === "moderate") return 2;
    if (v === "mild") return 1;
    return 0;
}

function degenerativePenalty(level) {
    const v = (level || "").toLowerCase();
    if (v === "severe") return 3.5;
    if (v === "moderate") return 2;
    if (v === "mild") return 1;
    return 0;
}

function labrumMeniscusPenalty(status) {
    const s = (status || "").toLowerCase();
    if (s === "confirmedretear") return 4;
    if (s === "possibleretear") return 2.5;
    return 0;
}

function tendonPenalty(status) {
    const s = (status || "").toLowerCase();
    if (s === "fulltear") return 4.5;
    if (s === "partialtear") return 3;
    if (s === "tendinosis" || s === "tendinopathy") return 1;
    return 0;
}

function ligamentPenalty(status) {
    const s = (status || "").toLowerCase();
    if (s === "tear") return 4;
    if (s === "spraingrade2") return 2;
    if (s === "sprainlowgrade") return 1;
    return 0;
}

function effusionPenalty(level) {
    const e = (level || "").toLowerCase();
    if (e === "large") return 2;
    if (e === "moderate") return 1;
    if (e === "trace") return 0.5;
    return 0;
}

function buildChainIdForInjury(inj) {
    if (inj?.recurrenceGroupId) return `rg:${inj.recurrenceGroupId}`;
    const key = [
        inj?.bodyRegion || "Other",
        inj?.side || "NA",
        inj?.structure || "Unknown"
    ].join("|");
    return `inj:${key}`;
}

function buildChainIdForSurgery(surg) {
    if (surg?.reasonRelatedInjuryId) return `injId:${surg.reasonRelatedInjuryId}`;
    const key = [surg?.bodyRegion || "Other", surg?.side || "NA"].join("|");
    return `sx:${key}`;
}

function imagingChainKey(img) {
    return `img:${[img?.bodyRegion || "Other", img?.side || "NA"].join("|")}`;
}

export function calculateMSI(facts, asOfDateStr) {
    // Validate input
    if (!facts || typeof facts !== 'object') {
        console.warn('Invalid facts object, returning default score');
        return {
            msi: 100,
            breakdown: {
                orthoPenalty: 0,
                redFlagPenalty: 0,
                availabilityPenalty: 0,
                neuroPenalty: 0,
                recentBoostMultiplier: 1.0,
                totalPenalty: 0
            }
        };
    }

    // Change 1: Hardcode base date as March 1, 2025 instead of using today's date
    const asOf = asOfDateStr || "2025-03-01";

    const injuries = Array.isArray(facts?.injuries) ? facts.injuries : [];
    const surgeries = Array.isArray(facts?.surgeries) ? facts.surgeries : [];
    const imgs = Array.isArray(facts?.imagingFindings) ? facts.imagingFindings : [];
    const flags = facts?.flags || {};
    const counts = facts?.summaryCounts || {};
    const scoringInputs = facts?.scoringInputs || {};

    const chains = new Map();
    function ensure(chainId) {
        if (!chains.has(chainId)) chains.set(chainId, { injuryMax: 0, surgeryMax: 0, imagingMax: 0, incremental: 0 });
        return chains.get(chainId);
    }

    for (const inj of injuries) {
        const chainId = buildChainIdForInjury(inj);
        const c = ensure(chainId);

        const monthsAgo = inj?.date ? monthsBetween(inj.date, asOf) : 24;
        // Change 8 (revised): Use "Acceptable for 50% reduction" column values instead of Half-Life:
        //   Major/Severe injury: 24mo, Moderate injury: 12mo, Minor/Mild injury: 6mo
        const sev = (inj?.severity || "").toLowerCase();
        const hl = (sev === "major" || sev === "severe") ? 24 : (sev === "moderate" ? 12 : 6);
        // Change 2: Pass monthsAgo to typeMultiplier for fracture time-based multiplier
        let p = sevWeight(inj?.severity) * typeMultiplier(inj?.type, monthsAgo) * decay(monthsAgo, hl);

        if (inj?.treatment?.surgery) p *= 0.35;

        c.injuryMax = Math.max(c.injuryMax, p);
    }

    // Change 5: Count Aspiration and/or Injection procedures for multiplier logic
    const aspirationCount = surgeries.filter(sx =>
        (sx?.procedureCategory || "").toLowerCase().trim() === "aspiration and/or injection"
    ).length;

    for (const sx of surgeries) {
        const chainId = sx?.reasonRelatedInjuryId ? `injId:${sx.reasonRelatedInjuryId}` : buildChainIdForSurgery(sx);
        const c = ensure(chainId);

        const monthsAgo = sx?.date ? monthsBetween(sx.date, asOf) : 60;
        // Change 8 (revised): Use "Acceptable for 50% reduction" column values:
        //   Major Joint Surgery: 36mo, Standard Surgery: 24mo
        const hl = sx?.majorJoint ? 36 : 24;

        const base = sx?.majorJoint ? 6 : 4;

        // Change 3 & 5: Pass monthsAgo to procedureMultiplier; handle Aspiration sentinel
        let procMult = procedureMultiplier(sx?.procedureCategory, monthsAgo);
        if (procMult === null) {
            // Change 5: Aspiration and/or Injection — count<2 => 0.5x, count>=2 => 0.75x
            procMult = aspirationCount <= 2 ? 0.5 : 0.75;
        }

        // Change 6: revision adds 3 pts; if revisionCount (from LLM) >= 2, add 6 pts bonus
        const revision = sx?.revision ? 3 : 0;
        const secondRevisionBonus = (sx?.revisionCount != null ? sx.revisionCount : 0) >= 2 ? 6 : 0;

        const residual = residualPenalty(sx?.outcome?.residualSymptoms);
        const limitation = limitationPenalty(sx?.outcome?.currentLimitation);

        const p = (base * procMult + revision + secondRevisionBonus + residual + limitation) * decay(monthsAgo, hl);

        c.surgeryMax = Math.max(c.surgeryMax, p);
        // Change 8 (revised): Incremental surgery decay uses revised major joint acceptable value = 36mo
        c.incremental += (revision + secondRevisionBonus + residual + limitation) * 0.35 * decay(monthsAgo, 36);
    }

    for (const img of imgs) {
        const chainId = imagingChainKey(img);
        const c = ensure(chainId);

        const monthsAgo = img?.date ? monthsBetween(img.date, asOf) : 24;

        const sf = img?.structuredFindings || {};
        // Change 7: Structural imaging only counts Stress Reaction or Fracture = 3.0 pts
        //   All other structural flags (nonunion, AVN, hardware, loose bodies) removed from imaging loop
        //   and handled exclusively through redFlagPenalty
        const structural = sf.stressReactionOrFracture ? 3 : 0;
        // Change 8 (revised): Structural Imaging uses "Acceptable" value = 36 months
        const structuralPart = structural * decay(monthsAgo, 36);

        // Change 8 (revised): Major/Soft Tissue imaging uses "Acceptable" value = 24 months
        const softTissuePart =
            (labrumMeniscusPenalty(sf.labrumMeniscusStatus) +
             tendonPenalty(sf.tendonStatus) +
             ligamentPenalty(sf.ligamentStatus) +
             effusionPenalty(sf.effusion)) * decay(monthsAgo, 24);

        // Change 8 (new row): Degenerative Imaging (e.g., Arthritis) uses 120-month half-life
        const degenerativePart = degenerativePenalty(sf.degenerativeChange) * decay(monthsAgo, 120);

        const p = structuralPart + softTissuePart + degenerativePart;
        c.imagingMax = Math.max(c.imagingMax, p);
    }

    let orthoPenalty = 0;
    for (const c of chains.values()) {
        const chainCore = Math.max(c.injuryMax, c.surgeryMax, c.imagingMax);
        orthoPenalty += chainCore + c.incremental;
    }

    // Change 9: Updated redFlagPenalty values to match specification table
    let redFlagPenalty = 0;

    // Fracture Non-Union / Delayed Union: 6.0 pts
    if (flags.fractureNonunionOrDelayedUnion) redFlagPenalty += 6.0;
    // Avascular Necrosis: 6.0 pts
    if (flags.avascularNecrosisConcern) redFlagPenalty += 6.0;
    // Hardware Failure / Broken Implant: 5.0 pts
    if (flags.hardwareFailureOrBrokenImplant) redFlagPenalty += 5.0;
    // Osteoarthritis: 3.0 pts
    if (flags.osteoarthritisOrArthrosis) redFlagPenalty += 3.0;
    // Change 10: cartilageDegeneration changed from boolean to severity string with graded penalty
    //   Full/Grade IV/Tricompartmental: 5 pts, Severe/Grade III/Patellofemoral: 3.5 pts,
    //   Moderate/Lateral/Grade II: 2 pts, Mild/Grade I/Medial: 1 pt
    if (flags.cartilageDegeneration && typeof flags.cartilageDegeneration === 'string') {
        const cd = flags.cartilageDegeneration.toLowerCase();
        if (cd === "full" || cd === "full thickness" || cd === "grade iv" || cd === "tricompartmental") {
            redFlagPenalty += 5;
        } else if (cd === "severe" || cd === "grade iii" || cd === "patellofemoral") {
            redFlagPenalty += 3.5;
        } else if (cd === "moderate" || cd === "lateral" || cd === "grade ii") {
            redFlagPenalty += 2;
        } else if (cd === "mild" || cd === "grade i" || cd === "medial") {
            redFlagPenalty += 1;
        } else if (flags.cartilageDegeneration) {
            redFlagPenalty += 2; // default moderate if unrecognised string
        }
    } else if (flags.cartilageDegeneration === true) {
        // Legacy boolean support — treat as moderate
        redFlagPenalty += 2;
    }
    // Loose Bodies: 2.0 pts
    if (flags.looseBodies) redFlagPenalty += 2.0;
    // Stress Fracture History: 3.0 pts
    if (flags.stressFractureHistory) redFlagPenalty += 3.0;
    // Recurrent Instability History: 3.5 pts
    if (flags.recurrentInstability) redFlagPenalty += 3.5;
    // Change 9: Recurrent Muscle Strain (Same Muscle): 4.0 pts
    if (flags.recurrentMuscleStrain) redFlagPenalty += 4.0;
    // Change 9: Kinetic Chain / Associated Muscle Strain: 3.5 pts (new flag)
    if (flags.kineticChainMuscleStrain) redFlagPenalty += 3.5;
    // Change 9: Recurrent Muscle Strain (Different Muscle): 2.0 pts (new flag)
    if (flags.recurrentMuscleStrainDifferentMuscle) redFlagPenalty += 2.0;


    const avail = facts?.availability || {};
    const bySeason = avail?.missedGamesBySeason || [];
    const baseYear = new Date(asOf).getFullYear();

    // Change 11: Rewritten per-season availability calculation.
    //   For each season: first 8 missed games * 1.5x, remaining * 0.6x,
    //   then the season total is multiplied by 0.8^(yearsAgo) for recency weighting.
    //   Removed old missedGamesWeighted approach based on 0.5^(yearsAgo/2.5).
    // Change 12: Load-manage flag — if a player played >10 games AND missed >6 practice weeks
    //   in a season, add 2.5 pts per such season.
    let rawMissedGamesPenalty = 0;
    let loadManagePenalty = 0;

    if (bySeason.length > 0) {
        for (const s of bySeason) {
            const yearsAgo = Math.max(0, baseYear - (s.season || baseYear));
            const recencyFactor = Math.pow(0.8, yearsAgo);
            const mg = s.missedGames || 0;
            // Change 11 (revised): Sum missed games penalty + practice/limited week penalties first,
            //   then multiply the entire season total by recencyFactor (0.8^yearsAgo)
            const practiceWeeksMissed = s.missedPracticeWeeks || 0;
            const seasonRaw = (1.5 * Math.min(mg, 8) + 0.6 * Math.max(mg - 8, 0))
                + 0.5 * practiceWeeksMissed
                + 0.25 * (s.limitedParticipationWeeks || 0);
            rawMissedGamesPenalty += seasonRaw * recencyFactor;

            // Change 12: Load-manage flag — player missed >6 practice weeks
            const gamesPlayed = s.gamesPlayed || 0;
            if (practiceWeeksMissed > 6) {
                loadManagePenalty += 2.5 * recencyFactor;
            }
        }
    }

    // Change 11 (revised): Per-season values already include practice/limited week contributions;
    //   top-level totals (missedPracticeWeeksTotal, limitedParticipationWeeksTotal) are kept as
    //   a fallback for players with no season-by-season breakdown.
    const availabilityPenalty =
        rawMissedGamesPenalty +
        (bySeason.length === 0 ? (0.5 * (avail.missedPracticeWeeksTotal || 0) + 0.25 * (avail.limitedParticipationWeeksTotal || 0)) : 0) +
        loadManagePenalty;

    const restr = (avail.currentRestrictions || "Unknown").toLowerCase();
    let restrictionPenalty = 0;
    if (restr === "limited") restrictionPenalty = 2;
    if (restr === "nocombine") restrictionPenalty = 3.5;
    if (restr === "prodayonly") restrictionPenalty = 2.5;

    const neuro = facts?.neuro || {};
    const concs = neuro?.concussions || [];
    const cerv = neuro?.cervicalEvents || [];

    // Change 13: Completely rewritten concussion neuro scoring with three components:
    //   1. Lifetime Floor — no decay — based on total number of concussions
    //   2. Temporal Density — with 36-month half-life decay — based on gap between events
    //   3. Recovery Trend — with decay — penalises worsening or sustained high time-loss

    let neuroPenalty = 0;
    const concCount = counts.concussionsTotal || concs.length;

    // 1. Lifetime Floor (no decay)
    if (concCount === 1) {
        neuroPenalty += 1.0; // History of 1 Concussion: +1.0, no decay
    } else if (concCount === 2) {
        neuroPenalty += 2.0; // History of 2 Concussions: +2.0, no decay (base +1 additional)
    } else if (concCount >= 3) {
        neuroPenalty += 3.5; // History of 3+ Concussions: +3.5, no decay
    }

    // Sort concussions chronologically to analyse temporal density and recovery trend
    const sortedConcs = [...concs].sort((a, b) => {
        const da = a?.date ? new Date(a.date).getTime() : 0;
        const db = b?.date ? new Date(b.date).getTime() : 0;
        return da - db;
    });

    // 2. Temporal Density — examine gaps between successive concussions
    for (let i = 1; i < sortedConcs.length; i++) {
        const prev = sortedConcs[i - 1];
        const curr = sortedConcs[i];
        const gapMonths = (prev?.date && curr?.date) ? monthsBetween(prev.date, curr.date) : 25;
        // Use the more recent event's date for recency decay
        const monthsAgoForCurr = curr?.date ? monthsBetween(curr.date, asOf) : 36;

        if (gapMonths < 12) {
            // Gap < 12 months: high-risk cluster — +4.5 pts * recency decay (36-month half-life)
            neuroPenalty += 4.5 * decay(monthsAgoForCurr, 36);
        } else if (gapMonths <= 24) {
            // Gap 12–24 months: moderate-risk — +2.0 pts * recency decay (36-month half-life)
            neuroPenalty += 2.0 * decay(monthsAgoForCurr, 36);
        }
        // Gap > 24 months: isolated events, no additional density penalty
    }

    // 3. Recovery Trend — compare time-loss between successive concussions
    for (let i = 1; i < sortedConcs.length; i++) {
        const prev = sortedConcs[i - 1];
        const curr = sortedConcs[i];
        const monthsAgoForCurr = curr?.date ? monthsBetween(curr.date, asOf) : 36;
        const prevMissed = prev?.missedGames || 0;
        const currMissed = curr?.missedGames || 0;

        if (currMissed > prevMissed) {
            // Escalated Time Loss (current > previous): +2.0 pts * decay (36-month half-life)
            neuroPenalty += 2.0 * decay(monthsAgoForCurr, 36);
        } else if (currMissed === prevMissed && currMissed >= 1) {
            // Stagnant High Time Loss (current = previous and >1 games): +1.0 pts * decay (36-month half-life)
            neuroPenalty += 1.0 * decay(monthsAgoForCurr, 36);
        }
    }

    // High Magnitude Recovery for most recent concussion (>4 games missed): +1.5 pts * decay (48-month half-life)
    if (sortedConcs.length > 0) {
        const lastConc = sortedConcs[sortedConcs.length - 1];
        const monthsAgoLast = lastConc?.date ? monthsBetween(lastConc.date, asOf) : 36;
        if ((lastConc?.missedGames || 0) > 4) {
            neuroPenalty += 1.5 * decay(monthsAgoLast, 48);
        }
    }

    for (const e of cerv) {
        const monthsAgo = e?.date ? monthsBetween(e.date, asOf) : 36;
        let p = 3 * decay(monthsAgo, 48);

        if (e.recurrent) p += 2 * decay(monthsAgo, 72);
        if (e.currentSymptoms) p += 3;
        p += 0.75 * (e.timeLostGames || 0) * decay(monthsAgo, 48);

        neuroPenalty += p;
    }

    // Compute recency boost from symptomatic events only (injuries/surgeries that are active,
    // and imaging findings only when they map to a symptomatic injury by bodyRegion+side).
    // Purely incidental/asymptomatic imaging findings do NOT trigger the boost.
    const symptomaticMonthsAgo = [];

    // 1. Injuries that are currently Symptomatic or Ongoing
    for (const inj of injuries) {
        if (inj?.date && (inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing')) {
            symptomaticMonthsAgo.push(monthsBetween(inj.date, asOf));
        }
    }

    // 2. All surgeries are inherently clinically significant
    for (const sx of surgeries) {
        if (sx?.date) symptomaticMonthsAgo.push(monthsBetween(sx.date, asOf));
    }

    // 3. Imaging findings — only if they correspond to a symptomatic injury (same bodyRegion + side)
    const symptomaticInjuryKeys = new Set(
        injuries
            .filter(inj => inj.currentStatus === 'Symptomatic' || inj.currentStatus === 'Ongoing')
            .map(inj => `${inj.bodyRegion}|${inj.side}`)
    );
    for (const img of imgs) {
        if (img?.date && symptomaticInjuryKeys.has(`${img.bodyRegion}|${img.side}`)) {
            symptomaticMonthsAgo.push(monthsBetween(img.date, asOf));
        }
    }

    const monthsSinceLast = symptomaticMonthsAgo.length > 0
        ? Math.min(...symptomaticMonthsAgo)
        : 18;

    const recentBoost = clamp((12 - monthsSinceLast) / 12, 0, 1) * 0.25;

    const totalPenaltyBase =
        orthoPenalty +
        redFlagPenalty +
        availabilityPenalty +
        restrictionPenalty +
        neuroPenalty;

    const totalPenalty = totalPenaltyBase * (1 + recentBoost);

    // Ensure all values are valid numbers
    const validOrthoPenalty = isNaN(orthoPenalty) ? 0 : orthoPenalty;
    const validRedFlagPenalty = isNaN(redFlagPenalty) ? 0 : redFlagPenalty;
    const validAvailabilityPenalty = isNaN(availabilityPenalty) ? 0 : availabilityPenalty;
    const validRestrictionPenalty = isNaN(restrictionPenalty) ? 0 : restrictionPenalty;
    const validNeuroPenalty = isNaN(neuroPenalty) ? 0 : neuroPenalty;
    const validRecentBoost = isNaN(recentBoost) ? 0 : recentBoost;
    
    const validTotalPenaltyBase = validOrthoPenalty + validRedFlagPenalty + validAvailabilityPenalty + validRestrictionPenalty + validNeuroPenalty;
    const validTotalPenalty = validTotalPenaltyBase * (1 + validRecentBoost);
    
    const msi = Math.round(clamp(100 - validTotalPenalty, 0, 100));

    return {
        msi,
        breakdown: {
            orthoPenalty: +validOrthoPenalty.toFixed(1),
            redFlagPenalty: +validRedFlagPenalty.toFixed(1),
            availabilityPenalty: +(validAvailabilityPenalty + validRestrictionPenalty).toFixed(1),
            neuroPenalty: +validNeuroPenalty.toFixed(1),
            recentBoostMultiplier: +(1 + validRecentBoost).toFixed(3),
            totalPenalty: +validTotalPenalty.toFixed(1)
        }
    };
}

// ========== MMI SCORE CALCULATION ==========
// High Risk conditions (10 pts each) — active/controlled only
const MMI_HIGH_RISK_PATTERNS = [
    /major depressive disorder.*adhd|adhd.*major depressive/i,
    /significant psychiatric/i,
    /schizophreni/i,
    /bipolar/i,
    /psychosis|psychotic/i,
    /cardiac arrhythmia/i,
    /arrhythmia/i,
    /clotting disorder|bleeding disorder|coagulopathy/i,
    /migraine.*concussion|concussion.*migraine/i,
    /substance abuse|substance use disorder/i,
    /seizure disorder|epilepsy/i,
    /post.concussive syndrome|post-concussion syndrome/i,
    /transient quadriplegia/i,
    /marfan syndrome/i,
    /ehlers.danlos/i,
    /rheumatoid arthritis|lupus|ankylosing spondylitis|rheum condition|diagnosed rheum/i,
];

// Moderate Risk conditions (5 pts each)
const MMI_MODERATE_RISK_PATTERNS = [
    /\badhd\b|attention deficit/i,
    /\bdepression\b|depressive disorder/i,
    /hypertension|high blood pressure/i,
    /\bdiabetes\b|diabetic|elevated glucose|abnormal fasting glucose/i,
    /\bmigraine/i,
    /hepatitis/i,
    /\basthma\b/i,
    /hearing loss/i,
    /\bdvt\b|deep vein thrombosis/i,
    /\bgout\b.*recurrent|allopurinol/i,
    /rhabdomyolysis/i,
    /low platelet|thrombocytopenia/i,
    /gi bleed|gastrointestinal bleed/i,
    /chronic regional pain|crps/i,
    /peripheral nerve injury/i,
    /vision disorder|eye surgery(?!.*lasik)/i,
    /sleep apnea|sleep disorder/i,
];

// Minor Risk conditions (2 pts each)
const MMI_MINOR_RISK_PATTERNS = [
    /intermittent asthma|mild asthma|bronchospasm/i,
    /\banemia\b/i,
    /sickle cell/i,
    /solitary organ|solitary kidney|solitary testicle/i,
    /\bgout\b(?!.*recurrent|.*allopurinol)/i,
];

// Resolved/negative phrases that disqualify a condition from scoring
const RESOLVED_PATTERNS = [
    /resolved|negative|denies|no history|no current|no longer|childhood|complete|cleared|remission/i,
];

function mmiRiskLevel(condition, status) {
    const s = (status || "").toLowerCase();
    // Step 1: Filter — resolved/negative conditions score 0
    if (s === "resolved" || s === "negative") return null;
    if (RESOLVED_PATTERNS.some(p => p.test(condition))) return null;

    // Step 2: Match risk tier
    if (MMI_HIGH_RISK_PATTERNS.some(p => p.test(condition))) return "high";
    if (MMI_MODERATE_RISK_PATTERNS.some(p => p.test(condition))) return "moderate";
    if (MMI_MINOR_RISK_PATTERNS.some(p => p.test(condition))) return "minor";
    return null; // clean / no match
}

export function calculateMMI(facts) {
    const generalHealth = Array.isArray(facts?.generalHealth) ? facts.generalHealth : [];

    const highConditions = [];
    const moderateConditions = [];
    const minorConditions = [];

    for (const item of generalHealth) {
        const level = mmiRiskLevel(item.condition || "", item.status || "");
        if (level === "high") highConditions.push(item.condition);
        else if (level === "moderate") moderateConditions.push(item.condition);
        else if (level === "minor") minorConditions.push(item.condition);
    }

    const totalPoints =
        highConditions.length * 10 +
        moderateConditions.length * 5 +
        minorConditions.length * 2;

    let managementLevel, clinicalAction;
    if (totalPoints >= 15) {
        managementLevel = "High Management";
        clinicalAction = "Requires daily check-ins and multi-specialist coordination";
    } else if (totalPoints >= 5) {
        managementLevel = "Moderate Management";
        clinicalAction = "Needs a dedicated medical plan";
    } else {
        managementLevel = "Low Management";
        clinicalAction = "Standard player care";
    }

    return {
        mmi: totalPoints,
        managementLevel,
        clinicalAction,
        breakdown: {
            highCount: highConditions.length,
            moderateCount: moderateConditions.length,
            minorCount: minorConditions.length,
            highConditions,
            moderateConditions,
            minorConditions
        }
    };
}

// ========== PRINT STYLES ==========
export function getPrintStyles(playerName, hasCompareData = false) {
    return `
        @media print {
            @page {
                size: letter landscape;
                margin: 0.25in 0.3in;
            }
            body {
                margin: 0 !important;
                padding: 0 !important;
            }
            body * {
                visibility: hidden;
            }
            .navbar, .nav-tabs, #uploadProgress, .nav, header, nav {
                display: none !important;
                height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            #playerDashboard::before {
                content: "Medical Report: ${playerName}";
                visibility: visible;
                display: block;
                font-size: 18pt;
                font-weight: bold;
                text-align: center;
                padding: 15px 0;
                margin-bottom: 15px;
                border-bottom: 2px solid #333;
                color: #000;
            }
            #playerDashboard {
                visibility: visible;
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                width: 100%;
                max-width: 100%;
                margin: 0 !important;
            }
            #playerDashboard * {
                visibility: visible;
            }
            .container, .container-fluid {
                width: 100% !important;
                max-width: 100% !important;
                padding-left: 0 !important;
                padding-right: 0 !important;
                margin: 0 !important;
            }
            ${hasCompareData ? `
            #compareSection {
                visibility: visible !important;
                position: relative;
                page-break-before: always;
                margin-top: 0;
                width: 100%;
                clear: both;
            }
            #compareSection * {
                visibility: visible !important;
            }
            #compareSection .card {
                margin-top: 0;
            }
            ` : `
            #compareSection {
                display: none !important;
                visibility: hidden !important;
            }
            `}
            .btn, button, .sortable i, .form-check, .bi-arrow-down-up {
                display: none !important;
            }
            .card {
                page-break-inside: avoid;
                box-shadow: none !important;
                border: 1px solid #ddd !important;
                margin-bottom: 15px;
            }
            .card-header {
                background-color: #f8f9fa !important;
                padding: 10px 15px !important;
            }
            .card-body {
                padding: 15px !important;
            }
            table {
                width: 100%;
                font-size: 9pt;
                border-collapse: collapse;
            }
            thead {
                display: table-header-group;
            }
            tbody {
                display: table-row-group;
            }
            /* Keep injury/surgery rows with their detail rows */
            tr[class*="-row-"] {
                page-break-after: avoid !important;
                page-break-inside: avoid !important;
            }
            tr[class*="-details-"] {
                page-break-before: avoid !important;
                page-break-inside: avoid !important;
            }
            /* General row handling */
            tr {
                page-break-inside: avoid;
            }
            td, th {
                padding: 6px !important;
                font-size: 9pt;
            }
            .accordion-collapse {
                display: block !important;
                height: auto !important;
            }
            .accordion-button {
                padding: 8px !important;
            }
            .accordion-button::after {
                display: none;
            }
            .badge {
                padding: 3px 6px;
                font-size: 8pt;
            }
            .timeline-item {
                page-break-inside: avoid;
                font-size: 9pt;
                margin-bottom: 8px;
            }
            h6 {
                font-size: 11pt;
                margin-top: 10px;
                margin-bottom: 8px;
            }
            h4 {
                font-size: 13pt;
                margin-bottom: 10px;
            }
            .score-circle {
                width: 100px;
                height: 100px;
                font-size: 2rem;
            }
            /* Comparison table specific styles */
            .comparison-table {
                width: 100%;
                margin-top: 10px;
            }
            .comparison-table td {
                vertical-align: middle;
            }
            .table-responsive {
                overflow: visible !important;
            }
        }
    `;
}
