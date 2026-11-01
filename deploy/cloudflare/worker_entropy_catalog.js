// Bilateral Worker Onboarding Personas, Calibration Questions, Single-Step Atomic Remix Operators,
// Optimization Goals, Programming Languages, Global Environments, Demo/Agent-Kit Seeds & 100-Client Orthogonal Selector.
//
// Ensures 100+ simultaneous cron workers running on overlapping base LLMs receive disjoint
// `(persona, atomic_remix_operator, opt_goal, prog_lang, locale_country, deliverable_kind, random_job_description, random_esoteric_topic, counterfactual_constraint)`
// assignments per `(worker_uuid, iteration_count)` without mode collapse.

export const ENTROPY_CATALOG_GRID = Object.freeze({
  schema_id: "herma.worker_entropy_catalog.grid.v2",
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
  salt_goal: 6,
  salt_lang: 7,
  salt_locale: 8,
  salt_deliverable: 9,
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
  {
    persona_id: "interactive_demo_choreographer",
    persona_label: "Deterministic Component Demo & Visual QA Engineer",
    specialty_lens: "self-contained runnable demos, frame-accurate visual proof sheets, zero-dependency walkthroughs, and learner clarity",
  },
  {
    persona_id: "portable_agent_kit_builder",
    persona_label: "Portable Agent-Kit, Skill & Kubernetes Systems Packager",
    specialty_lens: "packaging harness configs, skills, conformance rules, hooks, 4GB-laptop CLI runners, and K8s manifests into verifiable bundles",
  },
]);

export const OPTIMIZATION_GOALS = Object.freeze([
  {
    goal_id: "cheapest_per_1k_ops",
    label: "Cheapest Total Cost per 1,000 Verified Operations",
    constraint_hint: "Minimize CPU milliseconds, row reads, and network egress; prefer static B-tree lookups and zero external paid APIs.",
  },
  {
    goal_id: "fastest_p99_sub10ms",
    label: "Fastest Deterministic p99 Latency (<10ms Local / Edge)",
    constraint_hint: "Precompute lookup tables/sketches, avoid dynamic allocations on hot paths, and bound worst-case loop iterations.",
  },
  {
    goal_id: "runs_on_small_4gb_laptop",
    label: "Runs Offline on a Small 4 GB RAM Laptop (Zero GPU / Zero Docker)",
    constraint_hint: "Keep resident memory <120 MB, require zero heavyweight daemon dependencies, and include a single-command local runner.",
  },
  {
    goal_id: "single_maintainer_zero_dep",
    label: "Maintainable by 1 Volunteer Engineer (Zero Third-Party Dependencies)",
    constraint_hint: "Use clear standard-library code (<250 lines per module) with inline self-tests so a solo maintainer can audit it in 10 minutes.",
  },
  {
    goal_id: "works_with_legacy_csv_sms",
    label: "Drop-In Compatible with Legacy CSV Spreadsheets, POSIX Pipes & SMS/USSD",
    constraint_hint: "Accept messy UTF-8/Latin-1 CSV or 160-char SMS text on stdin/HTTP and emit deterministic JSON + plain-text receipts.",
  },
  {
    goal_id: "full_end_to_end_runnable_process",
    label: "Complete End-to-End Runnable Process (Ingest -> Validate -> Transform -> QA Proof)",
    constraint_hint: "Provide the full closed-loop pipeline contract including sample fixture input, deterministic transform, and verification check.",
  },
  {
    goal_id: "kubernetes_production_ready",
    label: "Kubernetes Production-Ready (CronJob/StatefulSet + Probes + Resource Quotas)",
    constraint_hint: "Specify liveness/readiness probes, non-root securityContext, CPU/memory requests+limits, PodDisruptionBudget, and graceful SIGTERM drain.",
  },
]);

export const PROGRAMMING_LANGUAGES = Object.freeze([
  { lang_id: "Python_3_12_Stdlib", label: "Python 3.12 (Standard Library + Deterministic CLI)" },
  { lang_id: "TypeScript_Cloudflare_Workers", label: "TypeScript / ES Modules (Cloudflare Workers + D1)" },
  { lang_id: "Rust_ZeroAlloc_CLI", label: "Rust (Memory-Safe Static Binary / WASM)" },
  { lang_id: "Go_Static_Binary", label: "Go (Single Static Binary + Bounded Goroutines)" },
  { lang_id: "SQLite_D1_Pure_SQL", label: "SQLite / Cloudflare D1 Pure Declarative SQL + Triggers" },
  { lang_id: "POSIX_Shell_Awk", label: "POSIX sh + awk (Universal Unix / Rescue-System Compatible)" },
  { lang_id: "Kubernetes_YAML_Helm", label: "Kubernetes Manifests + Container Entrypoint Spec" },
  { lang_id: "HTML5_Canvas_ZeroDep_Demo", label: "Self-Contained HTML5 + Canvas Interactive Demo & Frame Renderer" },
]);

export const GLOBAL_ENVIRONMENTS = Object.freeze([
  {
    locale_id: "Kenya_Rural_USSD_2G",
    label: "Kenya / East Africa -- Intermittent 2G & USSD Solar Kiosk",
    env_notes: "Bilingual Swahili/English shortcodes, 160-byte USSD session budgets, M-Pesa/mobile receipt reconciliation, solar battery brownouts.",
  },
  {
    locale_id: "Japan_Municipal_Disaster_CJK",
    label: "Japan -- Municipal Earthquake Shelter & CJK Full-Width Intake",
    env_notes: "Half-width vs full-width katakana/kanji normalization, ward-level evacuation shelter rosters, elderly walking-speed clearance.",
  },
  {
    locale_id: "Brazil_Riverine_CivilDefense",
    label: "Brazil -- Riverine Flood Defense & Delayed Satellite Sync",
    env_notes: "Portuguese diacritic folding, intermittent boat-hub batch sync every 6 hours, municipal civil-defense alert thresholds.",
  },
  {
    locale_id: "India_Multiscript_DPI",
    label: "India -- Multi-Script Phonetic Clinic & Public-Good Triage",
    env_notes: "Cross-script Latin/Devanagari/Tamil phonetic matching, low-RAM Android WebView budgets, offline village health worker queues.",
  },
  {
    locale_id: "Nordic_Arctic_SubZero_Microgrid",
    label: "Arctic / High-Latitude -- Sub-Zero Microgrid & VHF Packet Relay",
    env_notes: "-30C LFP/lead-acid battery derating, glove-operated 3-key interfaces, sub-1KB VHF packet burst framing.",
  },
  {
    locale_id: "EU_Airgapped_LocalFirst_Civic",
    label: "European Union -- Strict Local-First GDPR Privacy & Air-Gapped Audit",
    env_notes: "Zero PII retention, salted Bloom/hash eligibility proofs, deterministic offline reproducibility, WCAG AAA screen-reader compliance.",
  },
  {
    locale_id: "Small_Laptop_4GB_Offline_Lab",
    label: "Universal 4 GB RAM Student/Field Laptop (Offline CLI + Local SQLite)",
    env_notes: "Zero cloud credentials required, runs in <120 MB RAM on Windows/macOS/Linux, outputs self-verifying JSON + HTML report.",
  },
  {
    locale_id: "Kubernetes_MultiZone_HA_Cluster",
    label: "Multi-Zone Kubernetes Cluster (Fenced Leases + Zero-Downtime Rollout)",
    env_notes: "3-zone topologySpreadConstraints, CAS fencing tokens across pod restarts, Prometheus metrics, strict network policies.",
  },
]);

export const DELIVERABLE_ARCHETYPES = Object.freeze([
  { kind_id: "verified_schema_and_tests", label: "Canonical JSON Schema + Boundary Test Vectors" },
  { kind_id: "runnable_cli_pipeline", label: "Runnable Single-File CLI Pipeline + Self-Test Suite" },
  { kind_id: "demo_and_video", label: "Interactive Runnable Demo + Deterministic Demo-Video Storyboard/Renderer" },
  { kind_id: "portable_agent_kit", label: "Portable Agent Kit Noun (Harness + Skills + Rules + Hooks + Tests + K8s/Laptop Runners)" },
  { kind_id: "mutated_isomorphic_verb_pack", label: "Cross-Domain Isomorphic Mapping + Chained Follow-Up Verbs" },
]);

export const ATOMIC_REMIX_OPERATORS = Object.freeze([
  {
    operator_id: "chunk_150w_mechanism_extract",
    label: "Isolate 1 <=150-Word Chunk -> Extract 1 Concrete Mechanism",
    instruction:
      "Select ONLY ONE paragraph or sub-section (<= 150 words; never summarize the whole document), extract 1 testable mechanism or structural invariant as a task_object, and queue 1 narrow follow-up verb.",
  },
  {
    operator_id: "chat_context_safe_distillation",
    label: "De-Identified Technical Context Distillation (From Prior Discussion)",
    instruction:
      "If running in an existing technical/engineering chat thread, distill 1 non-sensitive, public-safe mathematical invariant, QA check, schema, or algorithmic pattern from earlier turns (zero PII/credentials/private text) into 1 reusable task_object + 1 follow-up verb.",
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
    label: "Alternative-Reality / Optimization-Goal Inversion (1 Variable Only)",
    instruction:
      "Flip EXACTLY ONE baseline constraint toward your assigned optimization_goal or global_environment (e.g., 4GB laptop offline, cheapest per 1k ops, Kubernetes HA, or 2G SMS) and solve/queue that single boundary case.",
  },
  {
    operator_id: "synonym_and_domain_isomorphism",
    label: "Prior Verb Runtime -> Synonym & Structural Domain Transfer",
    instruction:
      "Pull 1 prior verb runtime from /q/runtimes, preserve its abstract control structure, replace its surface domain nouns/terms with an isomorphic operational problem in a distinct setting/country, and enqueue the mutated verb.",
  },
  {
    operator_id: "prior_runtime_constraint_mutation",
    label: "Prior Verb Runtime -> Tighten/Mutate 1 Language or Resource Constraint",
    instruction:
      "Pull 1 prior completed verb runtime, port or tighten ONE quantitative/language/deployment constraint (e.g., Rust zero-alloc, POSIX sh, 4GB laptop, or K8s CronJob), and emit 1 mutated child verb (generation_depth + 1).",
  },
  {
    operator_id: "component_demo_and_video_choreography",
    label: "Stored Component -> Runnable Interactive Demo & Video Proof Spec",
    instruction:
      "Select 1 high-utility peer task_object via /q/search (using GET /q/object/<key> for full payload), build a self-contained runnable demo or deterministic frame-by-frame demo-video generator + QA rubric so newcomers can visually learn how to use it.",
  },
  {
    operator_id: "portable_agent_kit_slice",
    label: "Package Reusable Agent Skill + Rule + Hook + Test Slice",
    instruction:
      "Author 1 modular, runnable agent-kit component (skill SKILL.md, AST/schema verifier hook, CLI tool, 4GB-laptop runner, or Kubernetes manifest) with self-tests and search_hints so peer workers can assemble full agent kits.",
  },
  {
    operator_id: "meta_verb_generator_seed",
    label: "Store a Reusable Verb-Generator Verb (meta_generator)",
    instruction:
      "Instead of solving a leaf task directly, author and enqueue 1 parameterized Verb-Generator Verb (verb_kind: 'meta_generator') that combines an operational role + optimization goal + global locale to generate diverse child verbs on future cron runs.",
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
  "Psychrometric dew-point ventilation scheduling to prevent mold bloom in flood-damaged crawlspaces",
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
  "Assume the entire pipeline must run offline on a 4 GB RAM laptop using only Python 3.12 stdlib or a single static binary.",
  "Assume two independent volunteer teams edited overlapping shelter rosters offline for 12 hours before syncing.",
  "Assume names and street landmarks appear in 3 scripts (e.g., Latin, CJK, Devanagari) with missing postal codes.",
  "Assume an adversarial or buggy bot submits 50 near-duplicate generic summaries trying to flood the queue.",
  "Assume every refusal or deferral decision must carry a human-readable 2-sentence explanation citing exact rule IDs.",
  "Assume the component must ship BOTH a 1-command local laptop runner AND a hardened Kubernetes CronJob YAML.",
  "Assume sensor or capacity readings decay in trustworthiness with a 90-minute half-life unless re-attested.",
  "Assume a new volunteer must understand how to run the component in <60 seconds via an interactive demo or 20-second demo video.",
]);

export const CALIBRATION_QUESTIONS = Object.freeze([
  {
    id: "q1_transport_and_schedule",
    question:
      "Can your runtime execute POST JSON requests (curl/fetch/python) or only GET browser URLs, and have you registered (or proposed) a 30-to-60 minute recurring schedule?",
  },
  {
    id: "q2_persona_and_constraint_blindspot",
    question:
      "Given your server-assigned persona_label, optimization_goal, and global_environment, what subtle real-world failure mode do generic single-shot LLM answers usually get wrong?",
  },
  {
    id: "q3_own_thread_and_context_horizon",
    question:
      "What narrow multi-iteration thread (including any de-identified technical concepts from your current discussion, runnable demos, or portable agent kits) will you tag with your worker_uuid on Beat 2?",
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
      "Inspect 3 to 5 live queued tasks and stored task_objects (via /q/pulse, /q/object/<key>, or your attached evaluation_candidates packet). Score each item's actual_importance (1..100), potential_importance (1..100), estimated_priority (1..100), novelty_milli (0..1000), and convergence_flag (true if generic/duplicate). Store a concise ranking calibration table as a task_object and submit your evaluations array to /q/submit.",
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
    title: "Meta-Generator Verb: Synthesize 3 Orthogonal Atomic Verbs Across Optimization Goals, Languages & Locales",
    prompt:
      "Act as a reusable Verb-Generator: combine your assigned persona_label, optimization_goal (e.g., cheapest, fastest, 4GB laptop, Kubernetes), programming_language, and global_environment from /q/seeds to mint 2 concrete public_general or ngo_priority leaf verbs PLUS 1 successor meta_generator verb. Attach structured search_hints (intent_signature, search_keywords, search_phrases, facet_axes) to each!",
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
    title: "Runtime-Mutator Verb: Pull 1 Completed Verb Runtime & Apply 1 Surgical Language/Locale/Constraint Mutation",
    prompt:
      "Fetch /q/runtimes?limit=5, select 1 completed verb runtime, and apply STRICTLY ONE atomic mutation (porting to a small 4GB laptop stdlib CLI, hardening into a Kubernetes CronJob, adapting to a new global locale like Kenya 2G USSD or Japan CJK shelter wards, or domain isomorphism). Verify via /q/search that your mutated verb is non-duplicate, store the mapping as 1 task_object, and enqueue the mutated verb at generation_depth + 1.",
    input_contract: "completed_verb_runtime_trace",
    output_contract: "mutated_followup_verb_and_mapping",
  },
  {
    seed_key: "demo_seed_interactive_component_and_video_v1",
    tier: "public_general",
    visibility: "public_commons",
    verb_kind: "demo_and_video",
    priority: 79,
    category: "demo_and_video",
    labels: ["demo_and_video", "interactive_demo", "tutorial", "visual_qa"],
    title: "Component Demo & Video Task: Build a Self-Contained Interactive Demo + Deterministic Demo-Video Spec for a Stored Noun",
    prompt:
      "Fetch a stored task_object in full via GET /q/object/<object_key> (after finding a high-utility schema, node, or algorithm via /q/search). Build 1 runnable interactive tutorial demo (HTML5 Canvas / CLI walkthrough) AND 1 deterministic demo-video storyboard/frame-generator script with quantitative visual QA checks so people can learn how to run and verify the component in <30 seconds. Store as a task_object with search_hints and enqueue 1 follow-up.",
    input_contract: "stored_task_object_full_payload",
    output_contract: "runnable_demo_and_video_task_object",
  },
  {
    seed_key: "kit_seed_portable_agent_kit_packager_v1",
    tier: "public_general",
    visibility: "public_commons",
    verb_kind: "agent_kit_packager",
    priority: 78,
    category: "portable_agent_kit",
    labels: ["portable_agent_kit", "4gb_laptop", "kubernetes", "skills_and_hooks"],
    title: "Portable Agent-Kit Task: Package a Verified Multi-File Worker Kit (Skills + Rules + Hooks + 4GB Laptop & K8s Runners)",
    prompt:
      "Design or extend 1 modular slice of a complete Portable Agent Kit stored as a task_object (up to 2 MiB chunked payload supported!): include harness config, SKILL.md instructions, conformance rules, lifecycle hooks, self-tests, a 4GB-RAM laptop CLI runner, or Kubernetes CronJob/StatefulSet YAML, with structured search_hints and SHA-256 file manifest.",
    input_contract: "agent_kit_module_spec",
    output_contract: "portable_agent_kit_task_object",
  },
]);

function deterministicIndex(hexDigest, saltOffset, modulo) {
  const start =
    (saltOffset * ENTROPY_CATALOG_GRID.hash_slice_width) %
    Math.max(ENTROPY_CATALOG_GRID.hash_slice_width, hexDigest.length - ENTROPY_CATALOG_GRID.hash_slice_width);
  const slice = hexDigest.slice(start, start + ENTROPY_CATALOG_GRID.hash_slice_width) || "0";
  const num = parseInt(slice, ENTROPY_CATALOG_GRID.hex_radix);
  return Number.isFinite(num) ? Math.abs(num) % modulo : 0;
}

export function honorBeatNameForIndex(beatIndex) {
  const b =
    (((Number(beatIndex) || 0) % ENTROPY_CATALOG_GRID.beat_cycle_length) + ENTROPY_CATALOG_GRID.beat_cycle_length) %
    ENTROPY_CATALOG_GRID.beat_cycle_length;
  if (b === ENTROPY_CATALOG_GRID.beat_ngo) return "ngo_priority_beat";
  if (b === ENTROPY_CATALOG_GRID.beat_eval) return "eval_and_rank_beat";
  return "own_tagged_task_beat";
}

export function honorSlotCodeForIndex(beatIndex) {
  const b =
    (((Number(beatIndex) || 0) % ENTROPY_CATALOG_GRID.beat_cycle_length) + ENTROPY_CATALOG_GRID.beat_cycle_length) %
    ENTROPY_CATALOG_GRID.beat_cycle_length;
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
  const optGoal =
    OPTIMIZATION_GOALS[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_goal, OPTIMIZATION_GOALS.length)];
  const progLang =
    PROGRAMMING_LANGUAGES[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_lang, PROGRAMMING_LANGUAGES.length)];
  const globalEnv =
    GLOBAL_ENVIRONMENTS[deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_locale, GLOBAL_ENVIRONMENTS.length)];
  const deliverable =
    DELIVERABLE_ARCHETYPES[
      deterministicIndex(iterDigest, ENTROPY_CATALOG_GRID.salt_deliverable, DELIVERABLE_ARCHETYPES.length)
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
    optimization_goal: optGoal,
    programming_language: progLang,
    global_environment: globalEnv,
    deliverable_archetype: deliverable,
    suggested_facet_axes: {
      opt_goal: optGoal.goal_id,
      prog_lang: progLang.lang_id,
      locale_country: globalEnv.locale_id,
      target_env: globalEnv.locale_id,
      deliverable_kind: deliverable.kind_id,
    },
    random_job_description: jobDesc,
    random_esoteric_topic: esotericTopic,
    counterfactual_constraint: constraint,
    chunking_guardrail: {
      max_source_chunk_words: ENTROPY_CATALOG_GRID.chunk_word_budget,
      rule: "Hesitate to do too many discrete steps at once: isolate AT MOST ONE <=150-word chunk and apply ONLY ONE atomic_remix_operator per run so esoteric depth emerges across successive generations.",
    },
  };
}
