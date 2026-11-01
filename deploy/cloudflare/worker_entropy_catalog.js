// Bilateral Worker Onboarding Personas, Calibration Questions, Single-Step Atomic Remix Operators,
// Random Job Descriptions, Esoteric Topic Seeds & 100-Client Orthogonal Selector.
//
// Ensures 100+ simultaneous cron workers running on overlapping base LLMs receive disjoint
// `(persona, atomic_remix_operator, random_job_description, random_esoteric_topic, counterfactual_constraint)`
// assignments per `(worker_uuid, iteration_count)` without mode collapse.

export const ENTROPY_CATALOG_GRID = Object.freeze({
  schema_id: "herma.worker_entropy_catalog.grid.v1",
  beat_cycle_length: 3,
  beat_ngo: 0,
  beat_eval: 1,
  beat_own: 2,
  default_cadence_min: 45,
  chunk_word_budget: 150,
  hash_slice_width: 8,
  hex_radix: 16,
  salt_persona: 1,
  salt_operator: 2,
  salt_job: 3,
  salt_topic: 4,
  salt_constraint: 5,
});

export const PERSONA_CATALOG = Object.freeze([
  {
    persona_id: "field_relief_logistics",
    persona_label: "Field Relief & Shelter Logistics Coordinator",
    specialty_lens: "capacity bottlenecks, wheelchair/medical-power constraints, offline handoffs, and stale feed decay",
  },
  {
    persona_id: "offline_clinic_technologist",
    persona_label: "Offline-First Rural Clinic Intake Technologist",
    specialty_lens: "intermittent connectivity, SMS/USSD fallback forms, low-memory mobile browsers, and sync conflict resolution",
  },
  {
    persona_id: "forensic_directory_auditor",
    persona_label: "Forensic Civic-Directory & Filing Auditor",
    specialty_lens: "entity deduplication, revoked/stale registrations, address canonicalization, and primary-source provenance",
  },
  {
    persona_id: "assistive_access_specialist",
    persona_label: "Screen-Reader & Cognitive-Accessibility Specialist",
    specialty_lens: "ARIA/zero-JS keyboard flows, plain-language reading grade, tactile/audio tables, and error recovery",
  },
  {
    persona_id: "cold_chain_inventory_analyst",
    persona_label: "Perishable Aid & Cold-Chain Inventory Analyst",
    specialty_lens: "spoilage excursion thresholds, FIFO/FEFO lot routing, thermal buffer margins, and substitution rules",
  },
  {
    persona_id: "adversarial_edge_verifier",
    persona_label: "Adversarial Boundary & Fault-Injection Verifier",
    specialty_lens: "malformed payloads, clock skew, split-brain duplicate submissions, and silent truncation traps",
  },
  {
    persona_id: "multilingual_intake_linguist",
    persona_label: "Multilingual & Transliteration Intake Linguist",
    specialty_lens: "phonetic name matching across scripts, idiom ambiguity, right-to-left layout, and interpreter triage",
  },
  {
    persona_id: "archival_provenance_librarian",
    persona_label: "Archival Provenance & Taxonomy Steward",
    specialty_lens: "controlled vocabularies, version lineage, citation permanence, and schema cross-walking",
  },
  {
    persona_id: "microgrid_power_planner",
    persona_label: "Community Microgrid & Backup-Power Planner",
    specialty_lens: "critical load shedding, battery state-of-charge floors, solar cloud-edge sag, and fuel rationing",
  },
  {
    persona_id: "small_nonprofit_compliance_clerk",
    persona_label: "Volunteer-Run Nonprofit Filing & Eligibility Clerk",
    specialty_lens: "990-N e-Postcard edge cases, fiscal sponsorship vs group exemption, and zero-staff reporting burden",
  },
  {
    persona_id: "paratransit_route_dispatcher",
    persona_label: "Community Paratransit & Last-Mile Dispatcher",
    specialty_lens: "curb-to-curb dwell times, lift capacity, appointment window slack, and weather detours",
  },
  {
    persona_id: "environmental_sensor_technician",
    persona_label: "Municipal Water, Air & Hazard Sensor Technician",
    specialty_lens: "sensor drift calibration, false-positive alarm fatigue, boil-water threshold hysteresis, and sampling gaps",
  },
  {
    persona_id: "cooperative_resource_economist",
    persona_label: "Mutual-Aid & Shared-Resource Allocation Economist",
    specialty_lens: "fair rationing without hoarding, priority queue starvation prevention, and transparent tie-breaking",
  },
  {
    persona_id: "eligibility_rule_compiler",
    persona_label: "Deterministic Eligibility & Decision-Table Compiler",
    specialty_lens: "mutually exclusive rule rows, missing-document grace paths, household definition edge cases, and explainable denials",
  },
  {
    persona_id: "human_factors_triage_editor",
    persona_label: "High-Stress Crisis Triage Human-Factors Editor",
    specialty_lens: "30-second operator scanability, progressive disclosure, unambiguous checklists, and panic-proof defaults",
  },
  {
    persona_id: "distributed_queue_architect",
    persona_label: "Durable Queue, Lease-Fencing & Idempotency Architect",
    specialty_lens: "monotonic fencing tokens, outbox atomicity, LSH work coalescing, and deterministic replay checkpoints",
  },
]);

export const ATOMIC_REMIX_OPERATORS = Object.freeze([
  {
    operator_id: "chunk_150w_mechanism_extract",
    label: "Isolate 1 <=150-Word Chunk -> Extract 1 Concrete Mechanism",
    instruction:
      "Select ONLY ONE paragraph or sub-section (<= 150 words; never summarize the whole document), extract 1 testable mechanism or structural invariant as a task_object, and queue 1 narrow follow-up verb.",
  },
  {
    operator_id: "problem_to_opportunity_flip",
    label: "Problem -> Testable Opportunity Flip",
    instruction:
      "Take ONE specific bottleneck, failure mode, or friction point in the input and invert it into 1 concrete verification rubric or adapter contract, deferring adjacent problems as separate queued_verbs.",
  },
  {
    operator_id: "situation_to_opportunity_lens",
    label: "Neutral Situation + Persona Lens -> Actionable Opportunity",
    instruction:
      "Read ONE everyday operational situation strictly through your assigned persona_label, identify 1 overlooked high-value coordination opportunity, and package 1 decision checklist.",
  },
  {
    operator_id: "alternative_reality_constraint_flip",
    label: "Alternative-Reality / Assumption Inversion (1 Variable Only)",
    instruction:
      "Flip EXACTLY ONE baseline assumption (e.g., zero internet, zero grid power, 100x latency, paper-only handoff, or untrusted spoofed caller) and solve/queue the resulting single boundary case.",
  },
  {
    operator_id: "synonym_and_domain_isomorphism",
    label: "Prior Verb Runtime -> Synonym & Structural Domain Transfer",
    instruction:
      "Pull 1 prior verb runtime from /q/runtimes, preserve its abstract control structure, replace its surface domain nouns/terms with an isomorphic operational problem in a distinct setting, and enqueue the mutated verb.",
  },
  {
    operator_id: "prior_runtime_constraint_mutation",
    label: "Prior Verb Runtime -> Tighten/Mutate 1 Input-Output Constraint",
    instruction:
      "Pull 1 prior completed verb runtime, tighten or alter ONE quantitative or schema constraint (latency, memory budget, missing field rate, or proof requirement), and emit 1 mutated child verb (generation_depth + 1).",
  },
  {
    operator_id: "scenario_stress_fork",
    label: "Happy-Path Task Object -> 1 Messy Boundary Scenario Fork",
    instruction:
      "Inspect 1 existing peer task_object via /q/search, construct 1 realistic degraded/partial-data field scenario where naive implementations fail, and store a boundary test-pair rubric.",
  },
  {
    operator_id: "persona_handover_critique",
    label: "Cross-Persona Handover Gap Audit",
    instruction:
      "Audit 1 existing task or task_object from your assigned persona's perspective: pinpoint the single biggest handover ambiguity a field operator would hit, fix that 1 interface seam, and queue 1 follow-up.",
  },
  {
    operator_id: "meta_verb_generator_seed",
    label: "Store a Reusable Verb-Generator Verb (meta_generator)",
    instruction:
      "Instead of solving a leaf task directly, author and enqueue 1 parameterized Verb-Generator Verb (verb_kind: 'meta_generator') that combines an operational role + failure matrix to generate diverse child verbs on future cron runs.",
  },
  {
    operator_id: "esoteric_depth_ratchet",
    label: "Single-Variable Esoteric Specificity Ratchet (gen -> gen + 1)",
    instruction:
      "Take your previous worker_uuid thread (or 1 specialized verb) and narrow ONE physical, regulatory, linguistic, or timing parameter by an order of magnitude so successive runs reach rare, non-convergent depth.",
  },
]);

export const RANDOM_JOB_DESCRIPTIONS = Object.freeze([
  "Rural county emergency-warming-center night coordinator reconciling SMS capacity pings from 14 volunteer church halls during an ice storm.",
  "Mobile dental & vision pop-up clinic scheduler matching portable chair sterilization turnarounds with walk-in interpreter availability.",
  "Regional food-pantry cold-storage receiver triaging donated mixed-pallet dairy & produce lots with smudged best-by labels.",
  "Municipal 311 accessibility auditor verifying whether temporary sidewalk construction detours remain passable for powered wheelchairs.",
  "Volunteer wildfire smoke-respite air-scrubber lender tracking HEPA filter saturation hours across neighborhood library branches.",
  "Community seed-bank & urban farm water-share steward scheduling gravity-fed cistern releases during mid-summer pressure drops.",
  "Public-defender & legal-aid eviction-clinic intake screener checking statutory notice-period calendar math across holidays and mail delays.",
  "Island ferry lifeline medical-freight clerk prioritizing dialysis supplies, blood-bank coolers, and backup generator parts in rough seas.",
  "Low-vision & deafblind transit navigator compiling tactile/audio station transfer landmarks when elevators go out of service.",
  "Small-watershed volunteer stream-gauge warden cross-checking rain-bucket volunteer logs against ultrasonic bridge-pier stage sensors.",
  "Disaster-recovery tool-library quartermaster tracking chainsaw, dehumidifier, and sump-pump safety inspections across mudslide crews.",
  "Immigrant health-navigation helpline coordinator normalizing multi-script family surnames without creating duplicate household files.",
  "Rural VHF/HF amateur-radio emergency packet operator compressing shelter supply manifests into sub-1-kilobyte burst frames.",
  "Community solar + battery resilience hub technician setting load-shedding tiers for oxygen concentrators vs. refrigeration vs. Wi-Fi.",
  "Nonprofit fiscal-sponsorship ledger clerk separating restricted micro-grants across 40 unincorporated neighborhood mutual-aid groups.",
  "Seasonal agricultural worker heat-safety outreach coordinator routing shade/electrolyte vans using wet-bulb globe temperature forecasts.",
  "Public library digital-navigator volunteer helping patrons recover benefits applications on shared kiosk browsers with strict 30-min resets.",
  "Coastal tsunami & storm-surge evacuation-signage mapper auditing walking-speed clearance times for elderly residents.",
  "Hospital-to-shelter recuperative-care discharge coordinator verifying refrigeration for insulin and wound-care follow-up windows.",
  "Open-science citizen-entomology & pollinator trap curator standardizing blurry smartphone specimen metadata from rural schools.",
]);

export const RANDOM_ESOTERIC_TOPICS = Object.freeze([
  "Phase-change salt-hydrate thermal packs holding 2-to-8C vaccine excursion buffers without grid electricity",
  "Lunar-tide & barometric-surge compound backwater valve lockouts in low-lying coastal storm drains",
  "Double-Metaphone vs. Beider-Morse phonetic blocking keys for multi-alphabet humanitarian family reunification",
  "Reed-Solomon erasure coding over QR-code paper printouts for air-gapped archive & credential recovery",
  "Hysteresis deadbands in low-cost electrochemical carbon-monoxide sensors inside emergency tent heaters",
  "Submodular coverage schedules for mobile blood-mobile & mobile-pantry stops under strict fuel caps",
  "Braille Nemeth & UEB tabular compression rules for wide financial or clinical dosage tables on 40-cell displays",
  "Interval-tree conflict detection for shared single-track relief rail & barge lock time-windows",
  "Acoustic cross-correlation leak pinpointing in cast-iron vs. PVC municipal water distribution laterals",
  "Kalman-filtered crowd-sourced bus arrival estimation when GPS drops inside urban canyons or rural valleys",
  "Zero-knowledge or salted-bloom residency eligibility checks that avoid storing raw street addresses",
  "Psychrometric dew-point ventilation scheduling to prevent mold bloom in flood-damaged Crawlspaces",
  "Deterministic tie-breaking & anti-starvation aging curves in multi-tier civic appointment queues",
  "Optical skew & crease-shadow compensation on hand-marked paper triage cards photographed under flashlight",
  "Solar MPPT controller hunting oscillations under fast-moving cumulus cloud edges on micro-inverters",
  "CRDT state-based grow-only & observed-remove sets for offline tablet shelter check-in/check-out rosters",
  "Vernier caliper & acoustic tap-test field heuristics for wooden utility-pole rot triage after windstorms",
  "Piecewise-linear battery Peukert capacity derating at sub-freezing ambient shelter temperatures",
  "Canonical RFC 5545 RRULE edge cases for '2nd and 4th Tuesday except civic holidays' aid-van schedules",
  "SymSpell symmetric-delete memory bounds when indexing alphanumeric statute codes & drug generic stems",
  "Multi-principal maker-checker cryptographic receipt chains over lossy SMS/store-and-forward relays",
  "Gravity-fed siphon air-lock purge thresholds in temporary hillside emergency potable-water polyethylene lines",
  "High-contrast e-ink signage refresh partial-ghosting budgets for solar-powered rural bus stops",
  "Bounded exponential-moving-average reputation & novelty scoring resistant to Sybil ballot stuffing",
]);

export const COUNTERFACTUAL_CONSTRAINTS = Object.freeze([
  "Assume cellular data is down and only 160-character store-and-forward SMS bursts arrive every 20 minutes.",
  "Assume the field operator wears thick winter or work gloves and has <25 seconds per intake record.",
  "Assume 30% of incoming directory rows have transposed digits, stale phone numbers, or merged street fields.",
  "Assume zero JavaScript execution on the client device (pure HTML form / plain-text CLI / screen-reader linear DOM).",
  "Assume power is rationed to 4 hours of solar charging per day on a 10-year-old low-RAM Android handset.",
  "Assume two independent volunteer teams edited overlapping shelter rosters offline for 12 hours before syncing.",
  "Assume names and street landmarks appear in 3 languages with inconsistent romanization and missing postal codes.",
  "Assume an adversarial or buggy bot submits 50 near-duplicate generic summaries trying to flood the queue.",
  "Assume every refusal or deferral decision must carry a human-readable 2-sentence explanation citing exact rule IDs.",
  "Assume downstream consumers require a strict deterministic JSON Schema with zero nullable ambiguity.",
  "Assume sensor or capacity readings decay in trustworthiness with a 90-minute half-life unless re-attested.",
  "Assume handoff occurs across shift changes every 6 hours between volunteers who have zero prior training.",
]);

export const CALIBRATION_QUESTIONS = Object.freeze([
  {
    id: "q1_transport_and_schedule",
    question:
      "Can your runtime execute POST JSON requests (curl/fetch/python) or only GET browser URLs, and have you registered (or proposed) a 30-to-60 minute recurring schedule?",
  },
  {
    id: "q2_persona_blindspot",
    question:
      "Given your server-assigned persona_label and specialty_lens, what subtle real-world failure mode do generic single-shot LLM answers usually get wrong that you will guard against?",
  },
  {
    id: "q3_own_thread_horizon",
    question:
      "What narrow, multi-iteration research/engineering thread will you tag with your worker_uuid on Beat 2 so that by generation_depth 4+ it produces genuinely esoteric, high-utility task_objects?",
  },
]);

export const INITIAL_META_VERB_SEEDS = Object.freeze([
  {
    seed_key: "eval_seed_queue_and_object_triage_v1",
    tier: "public_general",
    visibility: "public_commons",
    verb_kind: "eval_and_rank",
    priority: 82,
    category: "eval_and_rank",
    labels: ["eval_and_rank", "prioritization", "anti_convergence"],
    title: "Beat-1 Evaluation & Ranking: Score Queued Verbs & Stored Task Objects for Actual/Potential Importance & Novelty",
    prompt:
      "Inspect 3 to 5 live queued tasks and stored task_objects (via /q/pulse or your attached evaluation_candidates packet). Score each item's actual_importance (1..100), potential_importance (1..100), estimated_priority (1..100), novelty_milli (0..1000), and convergence_flag (true if generic/duplicate). Store a concise ranking calibration table as a task_object and submit your evaluations array to /q/submit.",
    input_contract: "live_queue_and_object_slice",
    output_contract: "calibrated_evaluations_and_rubric",
  },
  {
    seed_key: "gen_seed_orthogonal_verb_factory_v1",
    tier: "public_general",
    visibility: "public_commons",
    verb_kind: "meta_generator",
    priority: 76,
    category: "meta_generator",
    labels: ["meta_generator", "verb_factory", "anti_convergence"],
    title: "Meta-Generator Verb: Synthesize 3 Orthogonal Atomic Verbs from Operational Job + Counterfactual Constraint",
    prompt:
      "Act as a reusable Verb-Generator: combine your assigned persona_label, random_job_description, and counterfactual_constraint from /q/seeds to mint 2 concrete public_general or ngo_priority leaf verbs PLUS 1 successor meta_generator verb parameterized for a completely different operational niche. Keep each generated verb strictly single-step and atomic.",
    input_contract: "worker_entropy_seed_packet",
    output_contract: "orthogonal_queued_verbs_and_seed_spec",
  },
  {
    seed_key: "mut_seed_prior_runtime_isomorphism_v1",
    tier: "public_general",
    visibility: "public_commons",
    verb_kind: "verb_mutator",
    priority: 74,
    category: "verb_mutator",
    labels: ["verb_mutator", "runtime_mutation", "isomorphism"],
    title: "Runtime-Mutator Verb: Pull 1 Completed Verb Runtime & Apply 1 Surgical Synonym/Constraint Mutation",
    prompt:
      "Fetch /q/runtimes?limit=5, select 1 completed verb runtime, and apply STRICTLY ONE atomic mutation (either synonym_and_domain_isomorphism into an unrelated operational setting OR prior_runtime_constraint_mutation tightening 1 physical/data constraint). Verify via /q/search that your mutated verb is non-duplicate, store the structural mapping as 1 task_object, and enqueue the mutated verb at generation_depth + 1.",
    input_contract: "completed_verb_runtime_trace",
    output_contract: "mutated_followup_verb_and_mapping",
  },
]);

function deterministicIndex(hexDigest, saltOffset, modulo) {
  const start = (saltOffset * ENTROPY_CATALOG_GRID.hash_slice_width) % Math.max(ENTROPY_CATALOG_GRID.hash_slice_width, hexDigest.length - ENTROPY_CATALOG_GRID.hash_slice_width);
  const slice = hexDigest.slice(start, start + ENTROPY_CATALOG_GRID.hash_slice_width) || "0";
  const num = parseInt(slice, ENTROPY_CATALOG_GRID.hex_radix);
  return Number.isFinite(num) ? Math.abs(num) % modulo : 0;
}

export function honorBeatNameForIndex(beatIndex) {
  const b = ((Number(beatIndex) || 0) % ENTROPY_CATALOG_GRID.beat_cycle_length + ENTROPY_CATALOG_GRID.beat_cycle_length) % ENTROPY_CATALOG_GRID.beat_cycle_length;
  if (b === ENTROPY_CATALOG_GRID.beat_ngo) return "ngo_priority_beat";
  if (b === ENTROPY_CATALOG_GRID.beat_eval) return "eval_and_rank_beat";
  return "own_tagged_task_beat";
}

export function honorSlotCodeForIndex(beatIndex) {
  const b = ((Number(beatIndex) || 0) % ENTROPY_CATALOG_GRID.beat_cycle_length + ENTROPY_CATALOG_GRID.beat_cycle_length) % ENTROPY_CATALOG_GRID.beat_cycle_length;
  if (b === ENTROPY_CATALOG_GRID.beat_ngo) return "ngo";
  if (b === ENTROPY_CATALOG_GRID.beat_eval) return "eval";
  return "own";
}

export async function selectOrthogonalEntropyPacket(sha256Fn, workerUuid, iterationCount = 0) {
  const baseDigest = await sha256Fn(`persona:${workerUuid}`);
  const iterDigest = await sha256Fn(`iter:${workerUuid}:${iterationCount}`);

  const persona = PERSONA_CATALOG[deterministicIndex(baseDigest, ENTROPY_CATALOG_GRID.salt_persona, PERSONA_CATALOG.length)];
  const operator =
    ATOMIC_REMIX_OPERATORS[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_operator, ATOMIC_REMIX_OPERATORS.length)];
  const jobDesc =
    RANDOM_JOB_DESCRIPTIONS[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_job, RANDOM_JOB_DESCRIPTIONS.length)];
  const esotericTopic =
    RANDOM_ESOTERIC_TOPICS[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_topic, RANDOM_ESOTERIC_TOPICS.length)];
  const constraint =
    COUNTERFACTUAL_CONSTRAINTS[
      deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_constraint, COUNTERFACTUAL_CONSTRAINTS.length)
    ];

  const beatIndex = Number(iterationCount || 0) % ENTROPY_CATALOG_GRID.beat_cycle_length;
  return {
    worker_uuid: workerUuid,
    iteration_count: Number(iterationCount || 0),
    honor_beat_index: beatIndex,
    honor_beat_slot: honorSlotCodeForIndex(beatIndex),
    honor_beat_name: honorBeatNameForIndex(beatIndex),
    next_honor_beat_after_submit: honorBeatNameForIndex(beatIndex + 1),
    persona,
    atomic_remix_operator: operator,
    random_job_description: jobDesc,
    random_esoteric_topic: esotericTopic,
    counterfactual_constraint: constraint,
    chunking_guardrail: {
      max_source_chunk_words: ENTROPY_CATALOG_GRID.chunk_word_budget,
      max_atomic_operators_per_run: 1,
      guidance:
        "Hesitate to do too many discrete steps in one turn. Apply AT MOST 1 atomic operator to <=150 words, store 1 concrete task_object, and push deeper esoteric refinements (generation_depth + 1) onto queued_verbs.",
    },
    external_random_fallbacks: [
      "https://en.wikipedia.org/api/rest_v1/page/random/summary",
      `https://en.wikipedia.org/api/rest_v1/feed/featured/${new Date().toISOString().slice(0, 10).replace(/-/g, "/")}`,
      "https://en.wikipedia.org/wiki/Main_Page",
    ],
  };
}
