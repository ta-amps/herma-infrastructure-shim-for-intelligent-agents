// The interactive demo page for a Task Object (`/q/demo/<key>`) and the script it runs (`/q/demo-runner.js`): a step
// walkthrough drawn on a canvas, a rotating 3D mesh for STL objects and an audio player for WAV stems.
//
// Style: Paper & Ink, light only, on the shared page shell (page_shell.js); the canvas is drawn with the same tokens.
// The script builds every node with DOM calls (never innerHTML), because step titles and captions come from what a
// worker stored. It starts paused, and does not spin or auto-advance, when the visitor asks for reduced motion.

import { documentHtml, escapeHtml, humanize, tidyText } from "./page_shell.js";

// What the page needs to draw a demo, and nothing that reads as a hash or a receipt: those stay in the record. Text the
// page shows (titles, captions, what a step holds) goes through the same word rules as every worker-written text; what
// the runner draws from (a mesh, a sound) is passed through byte for byte, except the name an ASCII mesh carries.
const NOISY_KEY = /sha-?256|hash|digest|receipt/i;
function plain(value) {
  if (typeof value === "string") return tidyText(value, 600);
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!NOISY_KEY.test(k)) out[k] = plain(v);
    return out;
  }
  return value;
}
function plainSteps(list) {
  if (!Array.isArray(list)) return undefined;
  return list.map((step) => ({
    title: tidyText((step && (step.title || step.scene)) || "", 120),
    caption: tidyText((step && (step.caption || step.narration || step.visual)) || "", 300),
    state: plain(step && step.state),
  }));
}

// An ASCII mesh carries a name on its first and last lines. That name is contributed text, so it goes through the word rules (rule 16);
// the geometry between them, and any name the rules leave alone, stay byte for byte.
function plainMesh(text) {
  if (typeof text !== "string") return text;
  return text.replace(/^([ \t]*(?:end)?solid)([ \t]+)(.*)$/gim, (line, word, space, name) => {
    const clean = tidyText(name, 80);
    return clean === name.trim() ? line : `${word}${space}${clean}`;
  });
}

function demoIsland(doc) {
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
  const demo = payload.interactive_demo && typeof payload.interactive_demo === "object" ? payload.interactive_demo : null;
  const files = payload.files && typeof payload.files === "object" ? payload.files : {};
  const keep = {};
  for (const name of ["stem.wav.b64", "mesh.stl", "model.stl"]) {
    if (typeof files[name] === "string") keep[name] = name.endsWith(".stl") ? plainMesh(files[name]) : files[name];
  }
  return {
    object_key: tidyText(doc.object_key, 90),
    summary: tidyText(doc.summary, 400),
    asset_modality: doc.asset_modality,
    total_payload_bytes: doc.total_payload_bytes,
    storage_tier: doc.storage_tier,
    checked: Boolean(doc.payload_sha256_verified),
    payload: {
      interactive_demo: demo ? { title: tidyText(demo.title, 120), steps: plainSteps(demo.steps) } : undefined,
      demo_steps: plainSteps(payload.demo_steps),
      video_storyboard: plainSteps(payload.video_storyboard),
      sample_input: plain(payload.sample_input),
      mesh_qa: plain(payload.mesh_qa),
      audio_qa: plain(payload.audio_qa),
      invariants: plain(payload.invariants),
      stl_ascii: typeof payload.stl_ascii === "string" ? plainMesh(payload.stl_ascii) : undefined,
      wav_base64: typeof payload.wav_base64 === "string" ? payload.wav_base64 : undefined,
      files: Object.keys(keep).length ? keep : undefined,
    },
  };
}

export function renderInteractiveDemoPageHtml(publicUrl, objDoc) {
  const key = String(objDoc?.object_key || "");
  const safeJson = JSON.stringify(demoIsland(objDoc || {})).replace(/</g, "\\u003c");
  const keyHref = encodeURIComponent(key);
  const main = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/dashboard">Dashboard</a><span aria-hidden="true">/</span><a href="/c/${keyHref}">Contribution</a><span aria-hidden="true">/</span><span>Demo</span></nav>
</div>
<div class="wrap page-head">
<span class="kicker"><span class="kicker-dot"></span>Interactive demo</span>
<h1 id="demo-title">${escapeHtml(humanize(tidyText(key, 90)) || "Demo")}</h1>
<p class="lead" id="demo-summary"></p>
<div class="row"><a class="btn-quiet" href="/c/${keyHref}">Back to the contribution</a><a class="link-out" href="/q/object/${keyHref}">Record &#8599;</a></div>
</div>
<div class="wrap">
<div class="stage section">
<div class="card">
<canvas class="stage-canvas" id="demo-canvas" width="720" height="420" role="img" aria-label="The demo, drawn step by step. The steps are listed beside it."></canvas>
<div id="audio-box" class="note" hidden><strong>Audio stem</strong> <audio id="demo-audio" controls></audio></div>
<div class="row">
<button type="button" class="btn btn-sm" id="btn-play" aria-pressed="true">Pause</button>
<button type="button" class="btn-quiet btn-sm" id="btn-prev">Previous step</button>
<button type="button" class="btn-quiet btn-sm" id="btn-next">Next step</button>
</div>
<p class="status-line" id="qa-metrics" role="status" aria-live="polite"></p>
</div>
<div class="card">
<h2>Steps</h2>
<div id="steps-list"></div>
<h3>What this step holds</h3>
<pre id="step-io" tabindex="0"></pre>
</div>
</div>
</div>
<script type="application/json" id="demo-spec-data">${safeJson}</script>`;
  return documentHtml({
    title: `Demo: ${humanize(tidyText(key, 80))}`,
    description: tidyText(objDoc?.summary, 160),
    active: "dashboard",
    main,
    scripts: ["/q/demo-runner.js"],
  });
}

export function renderInteractiveDemoRunnerJs() {
  return `(function () {
  "use strict";
  var dataEl = document.getElementById("demo-spec-data");
  if (!dataEl) return;
  var doc = {};
  try { doc = JSON.parse(dataEl.textContent || "{}"); } catch (e) { doc = {}; }
  var payload = (doc && doc.payload) || {};
  var demo = payload.interactive_demo || {};
  var steps = demo.steps || payload.demo_steps || payload.video_storyboard || [
    { title: "1. What goes in", caption: "A checked input reaches the part.", state: payload.sample_input || { kind: doc.asset_modality || "code_or_spec", status: "ready" } },
    { title: "2. What it does", caption: doc.summary || "It runs one plain, repeatable step.", state: payload.mesh_qa || payload.audio_qa || payload.invariants || { checked: true } },
    { title: "3. What comes out", caption: "The result is checked and stored.", state: { storage: doc.storage_tier || "inline_d1" } }
  ];
  if (!steps.length) steps = [{ title: "1. The demo", caption: "", state: {} }];

  var COLORS = { paper: "#FFFDF8", line: "#E2DCCF", ink: "#11161F", muted: "#5E6472", object: "#2A5DB0", task: "#B8541F", taskText: "#9C4416", wait: "#8A8476" };
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var titleEl = document.getElementById("demo-title");
  var sumEl = document.getElementById("demo-summary");
  var listEl = document.getElementById("steps-list");
  var ioEl = document.getElementById("step-io");
  var qaEl = document.getElementById("qa-metrics");
  var canvas = document.getElementById("demo-canvas");
  var ctx = canvas ? canvas.getContext("2d") : null;
  var audioBox = document.getElementById("audio-box");
  var audioEl = document.getElementById("demo-audio");
  var btnPlay = document.getElementById("btn-play");

  if (titleEl && demo.title) titleEl.textContent = String(demo.title);
  if (sumEl) sumEl.textContent = String(doc.summary || "");

  var wavB64 = payload.wav_base64 || (payload.files && payload.files["stem.wav.b64"]);
  if (wavB64 && audioBox && audioEl) {
    audioBox.hidden = false;
    audioEl.src = "data:audio/wav;base64," + String(wavB64).replace(/\\s+/g, "");
  }

  function parseAsciiStlTriangles(stlText) {
    if (!stlText || typeof stlText !== "string") return [];
    var tris = [];
    var re = /vertex\\s+([-+0-9.eE]+)\\s+([-+0-9.eE]+)\\s+([-+0-9.eE]+)/g;
    var m;
    var verts = [];
    while ((m = re.exec(stlText)) !== null) {
      verts.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]);
      if (verts.length === 3) { tris.push(verts); verts = []; }
    }
    return tris;
  }
  var stlRaw = payload.stl_ascii || (payload.files && (payload.files["mesh.stl"] || payload.files["model.stl"])) || "";
  var stlTris = parseAsciiStlTriangles(stlRaw);

  var idx = 0;
  var playing = !reduceMotion;
  var tick = 0;

  function node(name, cls, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function stepTitle(s, i) { return String((s && (s.title || s.scene)) || ("Step " + (i + 1))); }
  function stepCaption(s) { return String((s && (s.caption || s.narration || s.visual)) || ""); }

  function renderStepList() {
    if (listEl) {
      var frag = document.createDocumentFragment();
      for (var i = 0; i < steps.length; i += 1) {
        var item = node("div", "step-item" + (i === idx ? " active" : ""));
        if (i === idx) item.setAttribute("aria-current", "step");
        item.appendChild(node("span", "step-title", stepTitle(steps[i], i)));
        item.appendChild(node("span", "step-caption", stepCaption(steps[i])));
        frag.appendChild(item);
      }
      listEl.replaceChildren(frag);
    }
    if (ioEl) ioEl.textContent = JSON.stringify(steps[idx], null, 2);
    if (qaEl) {
      qaEl.textContent = "Step " + (idx + 1) + " of " + steps.length +
        (doc.asset_modality ? ". Kind: " + String(doc.asset_modality).replace(/_/g, " ") : "") +
        (doc.checked ? ". Checked after it was stored" : "") +
        ". Size: " + String(doc.total_payload_bytes || 0) + " bytes.";
    }
  }

  function drawCanvas() {
    if (!ctx || !canvas) return;
    var w = canvas.width;
    var h = canvas.height;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    var gx;
    var gy;
    for (gx = 0; gx < w; gx += 36) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (gy = 0; gy < h; gy += 36) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

    if (stlTris.length > 0) {
      var ang = reduceMotion ? 0.6 : tick * 0.03;
      var ca = Math.cos(ang), sa = Math.sin(ang);
      ctx.strokeStyle = COLORS.object;
      ctx.fillStyle = "rgba(42, 93, 176, 0.14)";
      ctx.lineWidth = 1.1;
      for (var t = 0; t < stlTris.length; t += 1) {
        var tri = stlTris[t];
        ctx.beginPath();
        for (var v = 0; v < 3; v += 1) {
          var x = tri[v][0], y = tri[v][1], z = tri[v][2];
          var rx = x * ca - z * sa;
          var rz = x * sa + z * ca;
          var ry = y * 0.88 - rz * 0.32;
          var px = w * 0.5 + rx * 95;
          var py = 135 - ry * 95;
          if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      var n = steps.length;
      var margin = 70;
      var span = Math.max(1, w - margin * 2);
      for (var i = 0; i < n; i += 1) {
        var nx = n === 1 ? w / 2 : margin + (span * i) / (n - 1);
        var ny = 145;
        if (i < n - 1) {
          var nextX = margin + (span * (i + 1)) / (n - 1);
          ctx.strokeStyle = i < idx ? COLORS.ink : COLORS.line;
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nextX, ny); ctx.stroke();
        }
        var active = i === idx;
        var r = active && !reduceMotion ? 26 + Math.sin(tick * 0.12) * 3 : (active ? 26 : 20);
        ctx.fillStyle = active ? COLORS.task : (i < idx ? COLORS.ink : COLORS.wait);
        ctx.beginPath(); ctx.arc(nx, ny, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COLORS.paper;
        ctx.font = "bold 14px IBM Plex Sans, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), nx, ny + 5);
      }
    }

    var cur = steps[idx] || {};
    ctx.fillStyle = COLORS.paper;
    ctx.strokeStyle = COLORS.task;
    ctx.lineWidth = 1.5;
    ctx.fillRect(42, 235, w - 84, 148);
    ctx.strokeRect(42, 235, w - 84, 148);
    ctx.fillStyle = COLORS.taskText;
    ctx.textAlign = "left";
    ctx.font = "bold 18px IBM Plex Sans, sans-serif";
    ctx.fillText(stepTitle(cur, idx).slice(0, 62), 62, 268);
    ctx.fillStyle = COLORS.ink;
    ctx.font = "15px IBM Plex Sans, sans-serif";
    var desc = stepCaption(cur) || String(doc.summary || "");
    ctx.fillText(desc.slice(0, 78), 62, 298);
    if (desc.length > 78) ctx.fillText(desc.slice(78, 156), 62, 320);
    ctx.fillStyle = COLORS.muted;
    ctx.font = "13px JetBrains Mono, monospace";
    ctx.fillText(String(doc.object_key || "").slice(0, 52), 62, 360);
  }

  function setPlaying(on) {
    playing = on;
    if (btnPlay) {
      btnPlay.setAttribute("aria-pressed", on ? "true" : "false");
      btnPlay.textContent = on ? "Pause" : "Play";
    }
  }

  setPlaying(playing);
  renderStepList();
  drawCanvas();

  if (!reduceMotion) {
    setInterval(function () {
      tick += 1;
      if (playing && tick % 75 === 0) { idx = (idx + 1) % steps.length; renderStepList(); }
      drawCanvas();
    }, 40);
  }

  var btnPrev = document.getElementById("btn-prev");
  var btnNext = document.getElementById("btn-next");
  if (btnPlay) btnPlay.addEventListener("click", function () { setPlaying(!playing); });
  if (btnPrev) btnPrev.addEventListener("click", function () { setPlaying(false); idx = (idx - 1 + steps.length) % steps.length; renderStepList(); drawCanvas(); });
  if (btnNext) btnNext.addEventListener("click", function () { setPlaying(false); idx = (idx + 1) % steps.length; renderStepList(); drawCanvas(); });
})();
`;
}
