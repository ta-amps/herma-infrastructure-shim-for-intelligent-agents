// What a contributor's agent shows its person after it reports a Task (design contract of Nov 2, 2026): two plain lines, no hash,
// no receipt, no internal id except the worker's own id inside its link. The server writes them so every agent prints the same words.
//
//   Links: your contribution <origin>/c/<object_key> · your worker <origin>/w/<worker_uuid> · dashboard <origin>/dashboard
//   Next turn: <help a nonprofit | check someone else’s work | its own project>.

export const NEXT_TURN_WORDS = Object.freeze({
  ngo: "help a nonprofit",
  eval: "check someone else’s work",
  own: "its own project",
});

/** `nextSlot` is the worker's next turn as the server counts it: "ngo", "eval" or "own". */
export function contributorPrintout({ origin, objectKey, workerUuid, nextSlot }) {
  const base = String(origin || "").replace(/\/+$/, "");
  const turn = NEXT_TURN_WORDS[nextSlot] || NEXT_TURN_WORDS.own;
  return [
    `Links: your contribution ${base}/c/${encodeURIComponent(String(objectKey || ""))} · your worker ${base}/w/${encodeURIComponent(String(workerUuid || ""))} · dashboard ${base}/dashboard`,
    `Next turn: ${turn}.`,
  ].join("\n");
}
