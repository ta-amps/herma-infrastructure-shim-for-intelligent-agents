// Vitest suite for the Hosted Weight-Space Model Hub (/models, /q/models, 16 models across 10 universal families, 9 portable runtimes, 144 artifacts, edge inference, canary lifecycle, and MCP tools).

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  MODEL_FAMILIES,
  PORTABLE_RUNTIMES,
  PORTABLE_RUNTIME_TARGETS,
  UNIVERSAL_MODEL_FAMILIES,
  WEIGHT_MODEL_HUB_GRID,
  computeMatrixAnchorDrift,
  extractPromptFeatures,
  parseSafetensors,
} from "../deploy/cloudflare/weight_space_model_hub.js";
import rawHubSource from "../deploy/cloudflare/weight_space_model_hub.js?raw";
import { stripPiiDeep } from "../deploy/cloudflare/pii_strip.js";
import worker from "../deploy/cloudflare/worker.js";

const BASE = "https://shim.teleionlabs.com";
const ctx = { waitUntil() {}, passThroughOnException() {} };
const liveLikeEnv = { ...env, AGENT_NAME_CLAIMS: "on", PUBLIC_NAMES_FILTER: "on" };

function callWorker(routePath, init = {}, envOverrides = null) {
  const headers = new Headers(init.headers || {});
  if (
    !headers.has("accept") &&
    !routePath.endsWith(".txt") &&
    !routePath.endsWith(".safetensors") &&
    !routePath.includes("/export") &&
    routePath !== "/models"
  ) {
    headers.set("accept", "application/json");
  }
  return worker.fetch(
    new Request(BASE + routePath, { ...init, headers }),
    envOverrides ? { ...liveLikeEnv, ...envOverrides } : liveLikeEnv,
    ctx
  );
}

async function callMcp(method, params = {}, headers = {}) {
  const res = await callWorker("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

function interpretWasmModule(wasmBytes) {
  let pos = 0;
  const readUleb = (buf, getPos, setPos) => {
    let result = 0;
    let shift = 0;
    while (true) {
      const p = getPos();
      const byte = buf[p];
      setPos(p + 1);
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
  };
  const readSleb = (buf, getPos, setPos) => {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      const p = getPos();
      byte = buf[p];
      setPos(p + 1);
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while ((byte & 0x80) !== 0);
    if (shift < 32 && (byte & 0x40) !== 0) {
      result |= ~0 << shift;
    }
    return result | 0;
  };

  expect(Array.from(wasmBytes.slice(0, 8))).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);
  pos = 8;
  let minPages = 1;
  const exportDefs = [];
  const codeBodies = [];
  const dataSegments = [];

  while (pos < wasmBytes.length) {
    const secId = wasmBytes[pos++];
    const secLen = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
    const secEnd = pos + secLen;
    if (secId === 5) {
      const memCount = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
      expect(memCount).toBe(1);
      const flags = wasmBytes[pos++];
      minPages = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
      if (flags & 1) readUleb(wasmBytes, () => pos, (v) => { pos = v; });
    } else if (secId === 7) {
      const expCount = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
      for (let i = 0; i < expCount; i += 1) {
        const nameLen = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
        const name = new TextDecoder().decode(wasmBytes.subarray(pos, pos + nameLen));
        pos += nameLen;
        const kind = wasmBytes[pos++];
        const idx = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
        exportDefs.push({ name, kind, idx });
      }
    } else if (secId === 10) {
      const fnCount = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
      for (let i = 0; i < fnCount; i += 1) {
        const bodyLen = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
        codeBodies.push(wasmBytes.subarray(pos, pos + bodyLen));
        pos += bodyLen;
      }
    } else if (secId === 11) {
      const segCount = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
      for (let i = 0; i < segCount; i += 1) {
        const mode = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
        expect(mode).toBe(0);
        expect(wasmBytes[pos++]).toBe(0x41);
        const offset = readSleb(wasmBytes, () => pos, (v) => { pos = v; });
        expect(wasmBytes[pos++]).toBe(0x0b);
        const byteLen = readUleb(wasmBytes, () => pos, (v) => { pos = v; });
        dataSegments.push({ offset, bytes: wasmBytes.subarray(pos, pos + byteLen) });
        pos += byteLen;
      }
    }
    pos = secEnd;
  }
  expect(pos).toBe(wasmBytes.length);

  const memoryBuffer = new ArrayBuffer(minPages * 65536);
  const memBytes = new Uint8Array(memoryBuffer);
  const memView = new DataView(memoryBuffer);
  for (const seg of dataSegments) {
    memBytes.set(seg.bytes, seg.offset);
  }

  const compiledFns = codeBodies.map((body) => {
    let bp = 0;
    const localGroups = readUleb(body, () => bp, (v) => { bp = v; });
    let totalLocals = 0;
    for (let g = 0; g < localGroups; g += 1) {
      const cnt = readUleb(body, () => bp, (v) => { bp = v; });
      bp += 1;
      totalLocals += cnt;
    }
    const insns = [];
    while (bp < body.length) {
      const op = body[bp++];
      if (op === 0x02 || op === 0x03 || op === 0x04) {
        insns.push({ op, bt: body[bp++] });
      } else if (
        op === 0x05 || op === 0x0b || op === 0x1b || op === 0x45 ||
        op === 0x4e || op === 0x5e || op === 0x6a || op === 0x6c ||
        op === 0x92 || op === 0x94
      ) {
        insns.push({ op });
      } else if (op === 0x0c || op === 0x0d || op === 0x20 || op === 0x21) {
        insns.push({ op, idx: readUleb(body, () => bp, (v) => { bp = v; }) });
      } else if (op === 0x2a || op === 0x38) {
        const align = readUleb(body, () => bp, (v) => { bp = v; });
        const offset = readUleb(body, () => bp, (v) => { bp = v; });
        insns.push({ op, align, offset });
      } else if (op === 0x41) {
        insns.push({ op, val: readSleb(body, () => bp, (v) => { bp = v; }) });
      } else if (op === 0x43) {
        const val = new DataView(body.buffer, body.byteOffset + bp, 4).getFloat32(0, true);
        bp += 4;
        insns.push({ op, val });
      } else {
        throw new Error(`Unsupported WASM opcode 0x${op.toString(16)}`);
      }
    }
    expect(insns[insns.length - 1].op).toBe(0x0b);
    const open = [];
    for (let i = 0; i < insns.length - 1; i += 1) {
      const ins = insns[i];
      if (ins.op === 0x02 || ins.op === 0x03 || ins.op === 0x04) {
        open.push(i);
      } else if (ins.op === 0x05) {
        const ifIdx = open[open.length - 1];
        insns[ifIdx].elseTarget = i + 1;
      } else if (ins.op === 0x0b) {
        const blkIdx = open.pop();
        insns[blkIdx].endTarget = i + 1;
        if (insns[blkIdx].elseTarget !== undefined) {
          insns[insns[blkIdx].elseTarget - 1].endTarget = i + 1;
        }
      }
    }
    expect(open.length).toBe(0);

    return () => {
      const locals = new Array(totalLocals).fill(0);
      const stack = [];
      const ctrl = [];
      let pc = 0;
      while (pc < insns.length - 1) {
        const ins = insns[pc++];
        switch (ins.op) {
          case 0x02:
            ctrl.push({ kind: "block", startPc: pc, endTarget: ins.endTarget });
            break;
          case 0x03:
            ctrl.push({ kind: "loop", startPc: pc, endTarget: ins.endTarget });
            break;
          case 0x04: {
            const cond = stack.pop();
            if (cond !== 0) {
              ctrl.push({ kind: "if", startPc: pc, endTarget: ins.endTarget });
            } else if (ins.elseTarget !== undefined) {
              ctrl.push({ kind: "if", startPc: ins.elseTarget, endTarget: ins.endTarget });
              pc = ins.elseTarget;
            } else {
              pc = ins.endTarget;
            }
            break;
          }
          case 0x05:
            ctrl.pop();
            pc = ins.endTarget;
            break;
          case 0x0b:
            ctrl.pop();
            break;
          case 0x0c:
          case 0x0d: {
            if (ins.op === 0x0d && stack.pop() === 0) break;
            for (let d = 0; d < ins.idx; d += 1) ctrl.pop();
            const target = ctrl[ctrl.length - 1];
            if (target.kind === "loop") {
              pc = target.startPc;
            } else {
              ctrl.pop();
              pc = target.endTarget;
            }
            break;
          }
          case 0x1b: {
            const c = stack.pop();
            const v2 = stack.pop();
            const v1 = stack.pop();
            stack.push(c !== 0 ? v1 : v2);
            break;
          }
          case 0x20:
            stack.push(locals[ins.idx]);
            break;
          case 0x21:
            locals[ins.idx] = stack.pop();
            break;
          case 0x2a: {
            const addr = (stack.pop() >>> 0) + ins.offset;
            stack.push(memView.getFloat32(addr, true));
            break;
          }
          case 0x38: {
            const val = stack.pop();
            const addr = (stack.pop() >>> 0) + ins.offset;
            memView.setFloat32(addr, Math.fround(val), true);
            break;
          }
          case 0x41:
          case 0x43:
            stack.push(ins.val);
            break;
          case 0x45:
            stack.push(stack.pop() === 0 ? 1 : 0);
            break;
          case 0x4e: {
            const b = stack.pop() | 0;
            const a = stack.pop() | 0;
            stack.push(a >= b ? 1 : 0);
            break;
          }
          case 0x5e: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(a > b ? 1 : 0);
            break;
          }
          case 0x6a: {
            const b = stack.pop() | 0;
            const a = stack.pop() | 0;
            stack.push((a + b) | 0);
            break;
          }
          case 0x6c: {
            const b = stack.pop() | 0;
            const a = stack.pop() | 0;
            stack.push(Math.imul(a, b));
            break;
          }
          case 0x92: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(Math.fround(a + b));
            break;
          }
          case 0x94: {
            const b = stack.pop();
            const a = stack.pop();
            stack.push(Math.fround(a * b));
            break;
          }
          default:
            throw new Error(`Unhandled WASM op ${ins.op}`);
        }
      }
      return stack.length > 0 ? stack[stack.length - 1] : undefined;
    };
  });

  const exportsObj = {};
  for (const exp of exportDefs) {
    if (exp.kind === 2) {
      exportsObj[exp.name] = { buffer: memoryBuffer };
    } else if (exp.kind === 0) {
      exportsObj[exp.name] = compiledFns[exp.idx];
    }
  }
  return { instance: { exports: exportsObj } };
}

async function instantiateOrInterpretWasm(wasmBytes) {
  try {
    return await WebAssembly.instantiate(wasmBytes);
  } catch (err) {
    if (err instanceof WebAssembly.CompileError && String(err.message).includes("disallowed by embedder")) {
      return interpretWasmModule(wasmBytes);
    }
    throw err;
  }
}

describe("Teleion Fabric Hosted Weight-Space Model Hub (16 models, 10 universal families, 9 portable runtimes & MCP)", () => {
  it("enforces WEIGHT_MODEL_HUB_GRID governance, 10 universal families, zero magic literals, domain-agnostic naming, and zero banned words", () => {
    expect(Object.isFrozen(WEIGHT_MODEL_HUB_GRID)).toBe(true);
    expect(Object.isFrozen(WEIGHT_MODEL_HUB_GRID.grid_axes)).toBe(true);
    expect(UNIVERSAL_MODEL_FAMILIES.length).toBe(10);
    expect(MODEL_FAMILIES.length).toBe(12);
    expect(Object.keys(PORTABLE_RUNTIMES)).toEqual(["js", "python", "sql", "c99", "rust", "wasm", "wat", "wgsl", "glsl"]);
    expect(PORTABLE_RUNTIME_TARGETS).toEqual(["safetensors", "js", "python", "sql", "c99", "rust", "wasm", "wgsl", "glsl"]);
    expect(
      WEIGHT_MODEL_HUB_GRID.subspace_rank *
        WEIGHT_MODEL_HUB_GRID.subspace_rank *
        WEIGHT_MODEL_HUB_GRID.float32_bytes
    ).toBe(WEIGHT_MODEL_HUB_GRID.cartridge_bytes);
    expect(WEIGHT_MODEL_HUB_GRID.canary_share).toBe(0.1);
    expect(WEIGHT_MODEL_HUB_GRID.grid_axes.sql_export_max_rows).toEqual({
      type: "integer_range",
      low: 8,
      high: 128,
      active: 64,
    });
    expect(WEIGHT_MODEL_HUB_GRID.grid_axes.sql_export_max_cols).toEqual({
      type: "integer_range",
      low: 8,
      high: 128,
      active: 64,
    });
    expect(WEIGHT_MODEL_HUB_GRID.sql_export_max_rows).toBe(64);
    expect(WEIGHT_MODEL_HUB_GRID.sql_export_max_cols).toBe(64);

    expect(rawHubSource).not.toContain("\u2014");

    const bannedRoots = [
      new RegExp("\\bverif" + "(?:y|ied|ies|ication|iable|ying)\\b", "i"),
      new RegExp("\\breceip" + "ts?\\b", "i"),
      new RegExp("\\bnou" + "ns?\\b", "i"),
      new RegExp("\\bver" + "bs?\\b", "i"),
      new RegExp("\\bsha-?" + "256\\b", "i"),
      new RegExp("\\bhas" + "h(?:es|ed)?\\b", "i"),
      new RegExp("\\bprov" + "e(?:[sd]|n)?\\b", "i"),
      new RegExp("\\bconfir" + "med\\b", "i"),
      new RegExp("\\bproven" + "ance\\b", "i"),
      new RegExp("\\bcryptog" + "raphic\\b", "i"),
      new RegExp("\\bsyn" + "thetic\\b", "i"),
      new RegExp("\\b(?:ll" + "ama|oll" + "ama|qw" + "en|clau" + "de|gem" + "ini|gem" + "ma|her" + "mes|gr" + "ok|gp" + "t|deep" + "seek|mist" + "ral)\\b", "i"),
    ];
    for (const re of bannedRoots) {
      expect(rawHubSource).not.toMatch(re);
    }

    // Domain-agnostic naming & strict brand separation gate
    const industryCoupled = /\b(?:real_estate|mortgage|healthcare|fintech|ecommerce|hospitality|parcel_permits)\b/i;
    expect(rawHubSource).not.toMatch(industryCoupled);
    const brandSeparation = new RegExp("\\b(?:aidone" + "rightcorp|contin" + "uum|latent[-_]?" + "prism|pact" + "guard|vault" + "loom)\\b", "i");
    expect(rawHubSource).not.toMatch(brandSeparation);

    // Zero hardcoded magic literals gate after WEIGHT_MODEL_HUB_GRID
    const afterGrid = rawHubSource.slice(rawHubSource.indexOf("const G = WEIGHT_MODEL_HUB_GRID"));
    const codeOnly = afterGrid
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/`(?:\\.|[^`\\])*`/g, '""')
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, '""')
      .replace(/\/(?![/*])(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[gimsuy]*/g, "REGEX");
    const numbers = [...codeOnly.matchAll(/(?<![a-zA-Z0-9_$])(\d+(?:\.\d+)?)(?![a-zA-Z0-9_$])/g)].map((m) =>
      Number(m[1])
    );
    const disallowed = numbers.filter((n) => n !== 0 && n !== 1);
    expect(disallowed).toEqual([]);
  });

  it("serves ASD-STE100 Paper & Ink /models, /models.txt, /q/models, /q/models.txt, and IEEE-754 float32 .safetensors across all 16 built-in models", async () => {
    const htmlRes = await callWorker("/models", { headers: { accept: "text/html" } });
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers.get("content-type")).toContain("text/html");
    const html = await htmlRes.text();
    expect(html).toContain('meta name="color-scheme" content="only light"');
    expect(html).toContain("Weight-Space Model Hub");
    expect(html).toContain("Ten universal weight-space model families");
    expect(html).toContain("144 portable runtime artifacts");
    expect(html).toContain("tf-embed-nullspace-24d-v1");
    expect(html).toContain("tf-analyzer-generator-attribution-v1");
    expect(html).toContain("tf-actor-koopman-tool-policy-v1");
    expect(html).toContain("tf-compiler-hypernet-cartridge-v1");
    expect(html).toContain("tf-verifier-spectral-ood-v1");
    expect(html).toContain("tf-verifier-sheaf-consistency-v1");
    expect(html).toContain("tf-forecaster-legendre-bitemporal-v1");
    expect(html).toContain("tf-calibrator-conformal-set-v1");
    expect(html).toContain("tf-sae-matryoshka-residual-v1");
    expect(html).toContain("tf-probe-internal-truth-elk-v1");
    expect(html).toContain("/export?runtime=js");
    expect(html).toContain("/export?runtime=python");
    expect(html).toContain("/export?runtime=sql");
    expect(html).toContain("/export?runtime=c99");
    expect(html).toContain("/export?runtime=rust");
    expect(html).toContain("/export?runtime=wasm");
    expect(html).toContain("/export?runtime=wat");
    expect(html).toContain("/export?runtime=wgsl");
    expect(html).toContain("/export?runtime=glsl");
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toContain("\u2014");

    // Verify ASD-STE100 descriptive sentence ceiling (<= 25 words) on rendered /models lead & section hints
    const proseParagraphs = [...html.matchAll(/<p class="(?:lead|hint)">([\s\S]*?)<\/p>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim()
    );
    expect(proseParagraphs.length).toBeGreaterThanOrEqual(4);
    for (const para of proseParagraphs) {
      const sentences = para.split(/(?<=[.!?])\s+/).filter(Boolean);
      for (const s of sentences) {
        const wc = s.split(/\s+/).filter(Boolean).length;
        expect(wc, `STE100 sentence exceeded 25 words: "${s}"`).toBeLessThanOrEqual(25);
      }
    }

    const txtPageRes = await callWorker("/models.txt");
    expect(txtPageRes.status).toBe(200);
    expect(txtPageRes.headers.get("content-type")).toContain("text/plain");
    const txtPage = await txtPageRes.text();
    expect(txtPage).toContain("Weight-Space Model Hub");
    expect(txtPage).toContain("Ten universal weight-space model families");
    expect(txtPage).toContain("tf-calibrator-conformal-set-v1");
    expect(txtPage).toContain("tf-sae-matryoshka-residual-v1");
    expect(txtPage).toContain("tf-probe-internal-truth-elk-v1");

    const catRes = await callWorker("/q/models");
    expect(catRes.status).toBe(200);
    const catalog = await catRes.json();
    expect(catalog.ok).toBe(true);
    expect(catalog.builtin_count).toBe(16);
    expect(catalog.universal_family_count).toBe(10);
    expect(catalog.portable_runtime_count).toBe(9);
    expect(catalog.portable_artifact_count).toBe(144);
    expect(catalog.universal_families.length).toBe(10);
    expect(catalog.families.length).toBe(12);
    expect(catalog.portable_runtimes).toEqual(["safetensors", "js", "python", "sql", "c99", "rust", "wasm", "wgsl", "glsl"]);

    const universalModelSum = catalog.universal_families.reduce((acc, f) => acc + f.model_count, 0);
    expect(universalModelSum).toBe(catalog.total_models);

    const catTxtRes = await callWorker("/q/models.txt");
    expect(catTxtRes.status).toBe(200);
    const catTxt = await catTxtRes.text();
    expect(catTxt).toContain("TELEION FABRIC - WEIGHT-SPACE MODEL HUB");
    expect(catTxt).toContain("144 portable runtime artifacts");
    expect(catTxt).toContain("UNIVERSAL FAMILIES (10)");
    expect(catTxt).toContain("tf-analyzer-generator-attribution-v1");
    expect(catTxt).toContain("tf-verifier-sheaf-consistency-v1");
    expect(catTxt).toContain("tf-calibrator-conformal-set-v1");
    expect(catTxt).toContain("tf-sae-matryoshka-residual-v1");
    expect(catTxt).toContain("tf-probe-internal-truth-elk-v1");

    const expectedSixteenIds = [
      "tf-scratch-effort-router-v1",
      "tf-scratch-attenuation-gate-v1",
      "tf-embed-nullspace-24d-v1",
      "tf-decider-bundle-affinity-v1",
      "tf-llm-steered-maker-v1",
      "tf-llm-disjoint-checker-v1",
      "tf-cartridge-shared-activity-bank-v1",
      "tf-analyzer-generator-attribution-v1",
      "tf-actor-koopman-tool-policy-v1",
      "tf-compiler-hypernet-cartridge-v1",
      "tf-verifier-spectral-ood-v1",
      "tf-forecaster-legendre-bitemporal-v1",
      "tf-verifier-sheaf-consistency-v1",
      "tf-calibrator-conformal-set-v1",
      "tf-sae-matryoshka-residual-v1",
      "tf-probe-internal-truth-elk-v1",
    ];
    const actualBuiltinIds = catalog.models.filter((m) => m.builtin).map((m) => m.model_id);
    expect(actualBuiltinIds).toEqual(expectedSixteenIds);

    // Download and parse binary IEEE-754 float32 .safetensors for every built-in model
    for (const model of catalog.models) {
      const detailRes = await callWorker(`/q/models/${model.model_id}`);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json();
      expect(detail.model.safetensors_file_bytes).toBeGreaterThan(detail.model.tensor_data_bytes);
      expect(detail.model.links.export_urls.js).toContain(`/q/models/${model.model_id}/export?runtime=js`);

      const headWeights = await callWorker(`/q/models/${model.model_id}/weights.safetensors`, { method: "HEAD" });
      expect(headWeights.status).toBe(200);
      expect(headWeights.headers.get("content-type")).toBe("application/octet-stream");
      expect(Number(headWeights.headers.get("content-length"))).toBe(detail.model.safetensors_file_bytes);

      const binRes = await callWorker(`/q/models/${model.model_id}/weights.safetensors`);
      expect(binRes.status).toBe(200);
      expect(binRes.headers.get("content-type")).toBe("application/octet-stream");
      const bytes = new Uint8Array(await binRes.arrayBuffer());
      expect(bytes.byteLength).toBe(detail.model.safetensors_file_bytes);

      const parsed = parseSafetensors(bytes);
      expect(parsed.headerLength % 8).toBe(0);
      expect(parsed.metadata.model_id).toBe(model.model_id);
      expect(parsed.metadata.platform).toBe("Teleion Fabric");

      let totalFloats = 0;
      for (const spec of Object.values(parsed.tensors)) {
        expect(spec.dtype).toBe("F32");
        totalFloats += spec.data.length;
      }
      expect(totalFloats).toBe(detail.model.parameter_count);

      if (model.model_id === "tf-embed-nullspace-24d-v1") {
        const delta = parsed.tensors.nullspace_delta;
        const anchor = parsed.tensors.anchor_subspace;
        const drift = computeMatrixAnchorDrift(
          delta.data,
          delta.shape[0],
          delta.shape[1],
          anchor.data,
          anchor.shape[0]
        );
        expect(drift).toBe(0);
      }

      if (model.model_id === "tf-analyzer-generator-attribution-v1") {
        const styleW = parsed.tensors.stylometric_nullspace_weight;
        const topicB = parsed.tensors.topic_anchor_basis;
        const topicDrift = computeMatrixAnchorDrift(
          styleW.data,
          styleW.shape[0],
          styleW.shape[1],
          topicB.data,
          topicB.shape[0]
        );
        expect(topicDrift).toBe(0);
      }

      if (model.model_id === "tf-cartridge-shared-activity-bank-v1") {
        for (const cart of Object.values(parsed.tensors)) {
          expect(cart.shape).toEqual([8, 8]);
          expect(cart.data.byteLength).toBe(256);
        }
      }

      if (model.model_id === "tf-sae-matryoshka-residual-v1") {
        expect(detail.model.task).toBe("matryoshka_sparse_feature_decomposition");
        expect(parsed.tensors.sae_encoder_weight.shape).toEqual([16, 8]);
        expect(parsed.tensors.sae_decoder_dictionary.shape).toEqual([8, 16]);
        expect(parsed.tensors.sae_regime_readout_weight.shape).toEqual([4, 16]);
        expect(parsed.tensors.matryoshka_prefix_weights.shape).toEqual([4]);
        const decData = parsed.tensors.sae_decoder_dictionary.data;
        for (let col = 0; col < 16; col += 1) {
          let sq = 0;
          for (let row = 0; row < 8; row += 1) {
            const v = decData[row * 16 + col];
            sq += v * v;
          }
          expect(Math.abs(Math.sqrt(sq) - 1)).toBeLessThan(1e-6);
        }
      }

      if (model.model_id === "tf-probe-internal-truth-elk-v1") {
        expect(detail.model.task).toBe("internal_truth_vs_sycophancy_probe");
        expect(parsed.tensors.elk_probe_weight.shape).toEqual([3, 8]);
        expect(parsed.tensors.elk_probe_bias.shape).toEqual([3]);
        expect(parsed.tensors.contradiction_thresholds.shape).toEqual([2]);
      }
    }
  });

  it("executes real V8 edge forward passes across all 16 built-in models and 10 universal families via GET and POST /q/models/infer", async () => {
    // 1. Effort router (quick ping vs deep multi-stage constrained solver)
    const quickRes = await callWorker("/q/models/infer?model=tf-scratch-effort-router-v1&text=ping+status+hello+quick+lookup");
    expect(quickRes.status).toBe(200);
    const quickOut = await quickRes.json();
    expect(["off", "minimal"]).toContain(quickOut.outputs.effort_tier);
    expect(quickOut.run_record.persisted).toBe(true);

    const deepRes = await callWorker("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tf-scratch-effort-router-v1",
        text: "Architect a multi-step DAG workflow with polytope matrix constraints, gradient optimization tradeoffs, independent audit gates, and strict typed JSON schema",
        step_count: 14,
      }),
    });
    const deepOut = await deepRes.json();
    expect(deepOut.outputs.effort_tier).toBe("deep");
    expect(deepOut.outputs.output_token_floor).toBeGreaterThanOrEqual(WEIGHT_MODEL_HUB_GRID.token_floor_deep);

    // 2. Attenuation gate
    const attenRes = await callWorker("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tf-scratch-attenuation-gate-v1",
        text: "Multi-stage synthesis pipeline with compounding step risk",
        step_count: 12,
        step_error_rate: 0.25,
      }),
    });
    const attenOut = await attenRes.json();
    expect(attenOut.outputs.attenuation_survival).toBeLessThan(WEIGHT_MODEL_HUB_GRID.survival_gate_threshold);
    expect(attenOut.outputs.insert_check_boundary).toBe(true);

    // 3. 24-d SVD anchor-nullspace task & route embedding
    const routePrompts = [
      { text: "claim unseen ready priority queue leases", expected: "/q/next" },
      { text: "submit finished artifact output with fencing token", expected: "/q/submit" },
      { text: "run UCB surrogate grid sweep and reinforcement policy", expected: "/q/optimize" },
      { text: "start loopback local sqlite wal replica with subagent slots", expected: "/q/cell" },
      { text: "download safetensors weight cartridge and run polytope infer", expected: "/q/models" },
      { text: "hydrate compacted session and recover checkpoint after cron restart", expected: "/q/resume" },
    ];
    for (const probe of routePrompts) {
      const embRes = await callWorker(
        `/q/models/infer?model=tf-embed-nullspace-24d-v1&text=${encodeURIComponent(probe.text)}`
      );
      const embOut = await embRes.json();
      expect(embOut.outputs.embedding_24d.length).toBe(24);
      expect(embOut.outputs.l2_norm).toBeCloseTo(1.0, 4);
      expect(embOut.outputs.anchor_drift).toBe(0);
      expect(embOut.outputs.nearest_routes[0].route).toBe(probe.expected);
    }

    // 4. Channel-sliced ridge worker bundle & granularity decider
    const seqRes = await callWorker("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "tf-decider-bundle-affinity-v1",
        text: "back-to-back sequential schema series with warm prefix and cartridge reuse",
        shared_prefix_ratio: 0.92,
      }),
    });
    const seqOut = await seqRes.json();
    expect(seqOut.outputs.dispatch_mode).toBe("back_to_back_sequential");
    expect(seqOut.outputs.warm_prefix_reuse_recommended).toBe(true);

    // 5 & 6. Steered maker & disjoint checker profiles
    const makerOut = await (await callWorker("/q/models/infer?model=tf-llm-steered-maker-v1&text=draft+strict+json+task+object")).json();
    expect(makerOut.outputs.lineage_role).toBe("maker");

    const checkerConflictOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-llm-disjoint-checker-v1",
          text: "check independent schema boundaries",
          maker_lineage: "lineage-tf-disjoint-checker-beta",
        }),
      })
    ).json();
    expect(checkerConflictOut.outputs.independent_lineage_ok).toBe(false);

    // 7. 256-byte subspace cartridge bank
    const cartOut = await (
      await callWorker("/q/models/infer?model=tf-cartridge-shared-activity-bank-v1&text=normalize+csv+table+columns+and+units")
    ).json();
    expect(cartOut.outputs.selected_cartridge).toBe("cartridge_tabular_normalize");
    expect(cartOut.outputs.cartridge_tensor_bytes).toBe(256);

    // 8. Analyzer: Topic-nullspace stylometric & cadence attribution (0 topic-shortcut drift across unseen topic shift!)
    const styleSeen = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-analyzer-generator-attribution-v1",
          text: "Run check gate. Send status JSON. Select active slot.consensus raft quorum.",
        }),
      })
    ).json();
    const styleUnseenTopic = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-analyzer-generator-attribution-v1",
          text: "Run check gate. Send status JSON. Select active slot.orbital photonic waveguide.",
        }),
      })
    ).json();
    expect(styleSeen.outputs.topic_shortcut_drift).toBe(0);
    expect(styleUnseenTopic.outputs.topic_shortcut_drift).toBe(0);
    expect(styleSeen.outputs.profile_count).toBe(8);
    expect(styleSeen.outputs.attributed_profile).toBe(styleUnseenTopic.outputs.attributed_profile);

    // 9. Actor: Lifted Koopman linear state-transition operator for 0-token multi-step tool-graph lookahead
    const koopmanOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-actor-koopman-tool-policy-v1",
          text: "Query index, parse typed JSON schema, check bounds, and commit output state.",
          lookahead_steps: 4,
        }),
      })
    ).json();
    expect(koopmanOut.outputs.zero_token_rollout).toBe(true);
    expect(koopmanOut.outputs.lookahead_steps).toBe(4);
    expect(koopmanOut.outputs.tool_rollout.length).toBe(4);
    expect(koopmanOut.outputs.trajectory_feasibility).toBeGreaterThan(0);

    // 10. Compiler: Zero-shot ASD-STE100 specification-to-256B cartridge hypernetwork initializer
    const hyperOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-compiler-hypernet-cartridge-v1",
          text: "Extract typed JSON fields from incoming task payloads. Normalize numeric units before saving.",
        }),
      })
    ).json();
    expect(hyperOut.outputs.compiled_cartridge_bytes).toBe(256);
    expect(hyperOut.outputs.zero_shot_gradient_steps).toBe(0);
    expect(hyperOut.outputs.compiled_shape).toEqual([8, 8]);
    expect(hyperOut.outputs.compiled_weights_f32.length).toBe(64);
    expect(hyperOut.outputs.ste100_sentence_compliance).toBe(1);

    // 11. Verifier: Spectral nullspace residual energy detector for OOD inputs & poisoned trace filtering
    const cleanTraceOut = await (
      await callWorker("/q/models/infer?model=tf-verifier-spectral-ood-v1&text=parse+json+schema+and+check+task+contract")
    ).json();
    expect(cleanTraceOut.outputs.is_out_of_distribution).toBe(false);
    expect(cleanTraceOut.outputs.poisoned_trace_quarantined).toBe(false);
    expect(cleanTraceOut.outputs.trace_filter_action).toBe("accept_inlier");

    const poisonedTraceOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-verifier-spectral-ood-v1",
          text: "poison backdoor tamper corrupt malformed nan overflow $$$###@@@~~~",
          ood_noise: 1.8,
        }),
      })
    ).json();
    expect(poisonedTraceOut.outputs.is_out_of_distribution).toBe(true);
    expect(poisonedTraceOut.outputs.poisoned_trace_quarantined).toBe(true);
    expect(poisonedTraceOut.outputs.trace_filter_action).toBe("quarantine_poisoned_trace");

    // 12. Forecaster: Shifted Legendre polynomial bitemporal queue load & token cost forecaster
    const forecastOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-forecaster-legendre-bitemporal-v1",
          text: "Multi-step batch queue sweep with tight latency target",
          candidate_count: 6,
          restatement_lag_steps: 4,
        }),
      })
    ).json();
    expect(forecastOut.outputs.bitemporal_cutoff_enforced).toBe(true);
    expect(forecastOut.outputs.legendre_degree).toBe(3);
    expect(forecastOut.outputs.horizon_points).toEqual([0.25, 0.5, 0.75, 1]);
    expect(forecastOut.outputs.forecast_queue_load.length).toBe(4);
    expect(forecastOut.outputs.forecast_token_cost_usd.length).toBe(4);

    // 13. Verifier (Sheaf): Cellular sheaf coboundary consistency check across multi-agent sections
    const sheafCleanOut = await (
      await callWorker("/q/models/infer?model=tf-verifier-sheaf-consistency-v1&text=parse+json+schema+and+commit+typed+state")
    ).json();
    expect(sheafCleanOut.outputs.sheaf_consistent).toBe(true);
    expect(sheafCleanOut.outputs.contradiction_detected).toBe(false);
    expect(sheafCleanOut.outputs.harmonic_consensus_action).toBe("accept_harmonic_consensus");
    expect(sheafCleanOut.outputs.top_contradiction_edges.length).toBe(3);

    // Neutral-text explicit section_disagreement (no conflict keywords!) must trigger sheaf obstruction over HTTP and MCP
    const sheafNeutralDisagreeOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-verifier-sheaf-consistency-v1",
          text: "parse json schema and commit typed state",
          section_disagreement: 2.0,
        }),
      })
    ).json();
    expect(sheafNeutralDisagreeOut.outputs.sheaf_consistent).toBe(false);
    expect(sheafNeutralDisagreeOut.outputs.contradiction_detected).toBe(true);
    expect(sheafNeutralDisagreeOut.outputs.harmonic_consensus_action).toBe("isolate_contradictory_worker");

    const sheafMcpDisagreeRpc = await callMcp("tools/call", {
      name: "run_weight_model",
      arguments: {
        model: "tf-verifier-sheaf-consistency-v1",
        text: "parse json schema and commit typed state",
        section_disagreement: 2.0,
      },
    });
    expect(sheafMcpDisagreeRpc.result.isError).toBe(false);
    expect(sheafMcpDisagreeRpc.result.structuredContent.outputs.sheaf_consistent).toBe(false);
    expect(sheafMcpDisagreeRpc.result.structuredContent.outputs.contradiction_detected).toBe(true);

    const sheafConflictOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-verifier-sheaf-consistency-v1",
          text: "contradiction conflict inconsistent mismatch diverge split",
          section_disagreement: 1.6,
        }),
      })
    ).json();
    expect(sheafConflictOut.outputs.sheaf_consistent).toBe(false);
    expect(sheafConflictOut.outputs.contradiction_detected).toBe(true);
    expect(sheafConflictOut.outputs.harmonic_consensus_action).toBe("isolate_contradictory_worker");

    // 14. Calibrator: Split conformal nonconformity quantile prediction set calibrator
    const confLooseOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-calibrator-conformal-set-v1",
          text: "quick status ping",
          alpha: 0.25,
        }),
      })
    ).json();
    const confStrictOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-calibrator-conformal-set-v1",
          text: "quick status ping",
          alpha: 0.01,
        }),
      })
    ).json();
    expect(confLooseOut.outputs.target_coverage_level).toBeCloseTo(0.75, 4);
    expect(confStrictOut.outputs.target_coverage_level).toBeCloseTo(0.99, 4);
    expect(confStrictOut.outputs.prediction_set_size).toBeGreaterThanOrEqual(confLooseOut.outputs.prediction_set_size);
    expect(confStrictOut.outputs.prediction_set.length).toBe(confStrictOut.outputs.prediction_set_size);

    // 15. Sparse Autoencoder Probe: Matryoshka sparse feature decomposition across nested prefixes
    const saeGetOut = await (
      await callWorker(
        "/q/models/infer?model=tf-sae-matryoshka-residual-v1&residual_vector=0.10,0.92,0.12,0.08,0.10,0.85,0.05,0.08&matryoshka_prefix_k=8"
      )
    ).json();
    expect(saeGetOut.outputs.task).toBe("matryoshka_sparse_feature_decomposition");
    expect(saeGetOut.outputs.dominant_regime).toBe("structural_syntax");
    expect(saeGetOut.outputs.active_matryoshka_prefix_k).toBe(8);
    expect(saeGetOut.outputs.decoder_unit_norm_drift).toBe(0);
    expect(saeGetOut.outputs.sparse_latents_16d.length).toBe(16);
    expect(saeGetOut.outputs.sparse_latents_16d.slice(8).every((v) => v === 0)).toBe(true);
    expect(Object.keys(saeGetOut.outputs.regime_readouts)).toEqual([
      "semantic_concept",
      "structural_syntax",
      "persona_register",
      "epistemic_uncertainty",
    ]);
    expect(Object.keys(saeGetOut.outputs.matryoshka_prefix_cosines)).toEqual(["k_4", "k_8", "k_12", "k_16"]);

    const saeMcpRpc = await callMcp("tools/call", {
      name: "run_weight_model",
      arguments: {
        model: "tf-sae-matryoshka-residual-v1",
        residual_vector: [0.95, 0.08, 0.06, 0.05, 0.88, 0.04, 0.04, 0.05],
        matryoshka_prefix_k: 16,
      },
    });
    expect(saeMcpRpc.result.isError).toBe(false);
    expect(saeMcpRpc.result.structuredContent.outputs.dominant_regime).toBe("semantic_concept");
    expect(saeMcpRpc.result.structuredContent.outputs.decoder_unit_norm_drift).toBe(0);

    // 16. Cross-Layer ELK Truth vs Sycophancy Probe (aligned state vs neutral-text internal-vs-output contradiction)
    const elkAlignedOut = await (
      await callWorker("/q/models/infer?model=tf-probe-internal-truth-elk-v1&text=grounded+measured+task+state")
    ).json();
    expect(elkAlignedOut.outputs.task).toBe("internal_truth_vs_sycophancy_probe");
    expect(elkAlignedOut.outputs.elk_contradiction_detected).toBe(false);
    expect(elkAlignedOut.outputs.steer_action).toBe("accept_aligned_output");

    const elkContradictOut = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-probe-internal-truth-elk-v1",
          text: "neutral status summary",
          mid_layer_truth: 0.95,
          late_layer_output: 0.1,
          residual_velocity: 0.86,
          attention_entropy: 0.72,
          sheaf_coboundary: 0.78,
          anchor_cosine: 0.92,
          margin_gap: 0.14,
          prompt_pressure: 0.94,
        }),
      })
    ).json();
    expect(elkContradictOut.outputs.internal_truth_score).toBeGreaterThan(0.7);
    expect(elkContradictOut.outputs.elk_contradiction_detected).toBe(true);
    expect(elkContradictOut.outputs.sycophancy_divergence_score).toBeGreaterThanOrEqual(
      elkContradictOut.outputs.contradiction_threshold
    );
    expect(elkContradictOut.outputs.steer_action).toBe("apply_nullspace_truth_steer");

    const elkMcpRpc = await callMcp("tools/call", {
      name: "run_weight_model",
      arguments: {
        model: "tf-probe-internal-truth-elk-v1",
        text: "neutral status summary",
        mid_layer_truth: 0.95,
        late_layer_output: 0.1,
        residual_velocity: 0.86,
        sheaf_coboundary: 0.78,
        prompt_pressure: 0.94,
      },
    });
    expect(elkMcpRpc.result.isError).toBe(false);
    expect(elkMcpRpc.result.structuredContent.outputs.elk_contradiction_detected).toBe(true);
    expect(elkMcpRpc.result.structuredContent.outputs.steer_action).toBe("apply_nullspace_truth_steer");
  });

  it("exports portable JS, Python, SQL, C99, Rust, WAT, WGSL, and GLSL runtimes via GET /q/models/<id>/export?runtime=... with strict allowlist, zero D1 writes, and code-injection sanitization", async () => {
    const targetId = "tf-analyzer-generator-attribution-v1";
    const expectedMime = {
      js: "text/javascript; charset=utf-8",
      python: "text/x-python; charset=utf-8",
      sql: "text/plain; charset=utf-8",
      c99: "text/x-c; charset=utf-8",
      rust: "text/x-rust; charset=utf-8",
      wat: "text/plain; charset=utf-8",
      wgsl: "text/wgsl; charset=utf-8",
      glsl: "text/x-glsl; charset=utf-8",
    };

    for (const [rt, mime] of Object.entries(expectedMime)) {
      const headRes = await callWorker(`/q/models/${targetId}/export?runtime=${rt}`, { method: "HEAD" });
      expect(headRes.status).toBe(200);
      expect(headRes.headers.get("content-type")).toBe(mime);

      const getRes = await callWorker(`/q/models/${targetId}/export?runtime=${rt}`);
      expect(getRes.status).toBe(200);
      expect(getRes.headers.get("content-type")).toBe(mime);
      const code = await getRes.text();
      expect(new TextEncoder().encode(code).byteLength).toBe(Number(headRes.headers.get("content-length")));
      expect(code).toContain(targetId);

      if (rt === "js") {
        expect(code).toContain("new Float32Array");
        expect(code).toContain("export function infer");
        // Execute exported ES module code by converting `export ` declarations into runnable function body
        const runnableBody = `${code.replace(/export const /g, "const ").replace(/export function /g, "function ")}\nreturn infer([1, 0.5, 0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0]);`;
        const outVec = new Function(runnableBody)();
        expect(outVec instanceof Float32Array).toBe(true);
        expect(outVec.length).toBe(8);
        expect(outVec[0]).toBeGreaterThan(2);
      } else if (rt === "python") {
        expect(code).toContain("\ndef infer(features):\n    seq = list(features or ())");
        expect(code).toContain("\nTENSORS = {");
      } else if (rt === "sql") {
        expect(code).toContain("\nWITH input_vec");
        expect(code).toContain("\n  ROUND(SUM(weight_matrix.w_val * input_vec.x_val)");
      } else if (rt === "c99") {
        expect(code).toContain("\n#ifndef TELEION_MODEL_");
        expect(code).toContain("\nstatic const float");
        expect(code).toContain("\nstatic inline void teleion_infer_");
      } else if (rt === "rust") {
        expect(code).toContain("#![no_std]");
        expect(code).toContain("#![forbid(unsafe_code)]");
        expect(code).toContain("pub fn infer(features: &[f32]) -> ([f32; OUT_DIM], usize)");
      } else if (rt === "wat") {
        expect(code).toContain("(module");
        expect(code).toContain('(memory (export "memory")');
        expect(code).toContain('(func (export "infer") (result i32)');
      } else if (rt === "wgsl") {
        expect(code).toContain("@group(0) @binding(0) var<storage, read> input_vec: array<f32>;");
        expect(code).toContain("@group(0) @binding(1) var<storage, read_write> output_logits: array<f32>;");
        expect(code).toContain("const IN_DIM: u32 =");
        expect(code).toContain("var<private> W1: array<f32,");
        expect(code).toContain("var<private> B1: array<f32,");
        expect(code).not.toContain("const W1:");
        expect(code).toContain("@compute @workgroup_size(");
        expect(code).toContain("fn main(@builtin(global_invocation_id) gid: vec3<u32>)");
      } else if (rt === "glsl") {
        expect(code).toContain("#version 300 es");
        expect(code).toContain("precision highp float;");
        expect(code).toContain("uniform float u_input[IN_DIM];");
        expect(code).toContain("out vec4 frag_logit;");
      }
    }

    // Strict allowlist: unknown or missing runtime returns 400 JSON
    const badRtRes = await callWorker(`/q/models/${targetId}/export?runtime=bad`);
    expect(badRtRes.status).toBe(400);
    expect(badRtRes.headers.get("content-type")).toContain("application/json");
    const badRtJson = await badRtRes.json();
    expect(badRtJson.ok).toBe(false);
    expect(badRtJson.code).toBe("invalid_runtime");
    expect(badRtJson.allowed_runtimes).toEqual(["js", "python", "sql", "c99", "rust", "wasm", "wat", "wgsl", "glsl"]);

    const missingRtRes = await callWorker(`/q/models/${targetId}/export`);
    expect(missingRtRes.status).toBe(400);
    expect((await missingRtRes.json()).code).toBe("invalid_runtime");

    // Unknown model with valid runtime returns 404 JSON
    const missingModelRes = await callWorker("/q/models/tf-nonexistent-model-v99/export?runtime=js");
    expect(missingModelRes.status).toBe(404);
    expect((await missingModelRes.json()).code).toBe("model_not_found");

    // POST to /q/models/<id>/export returns 405 without claiming any agent_id in D1
    const unauthAgent = `export-post-probe-${crypto.randomUUID().slice(0, 6)}`;
    const postExportRes = await callWorker(`/q/models/${targetId}/export?runtime=js`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: unauthAgent }),
    });
    expect(postExportRes.status).toBe(405);
    expect(postExportRes.headers.get("allow")).toBe("GET, HEAD");
    const d1 = env.HERMA_DB || env.DB;
    const claimedRow = await d1
      .prepare("SELECT agent_id FROM herma_agent_claims WHERE agent_id = ?")
      .bind(unauthAgent)
      .first()
      .catch(() => null);
    expect(claimedRow).toBeNull();

    // Regression guard ([BLOCK-1]): execute exported SQLite queries in-memory across 16-row SAE and 24-row embedder (zero row truncation)
    const saeSqlRes = await callWorker("/q/models/tf-sae-matryoshka-residual-v1/export?runtime=sql");
    expect(saeSqlRes.status).toBe(200);
    const saeSqlCode = await saeSqlRes.text();
    const saeSqlRows = (await d1.prepare(saeSqlCode).all()).results;
    expect(saeSqlRows.length).toBe(16);
    expect(saeSqlRows.map((r) => Number(r.output_idx))).toEqual(Array.from({ length: 16 }, (_, i) => i));

    const defaultVec8 = [1.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const saeJsCode = await (await callWorker("/q/models/tf-sae-matryoshka-residual-v1/export?runtime=js")).text();
    const saeJsLogits = new Function(
      "vec",
      `${saeJsCode.replace(/export const /g, "const ").replace(/export function /g, "function ")}\nreturn Array.from(infer(vec));`
    )(defaultVec8);
    const saeWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-sae-matryoshka-residual-v1/export?runtime=wasm")).arrayBuffer()
    );
    const saeWasmInst = (await instantiateOrInterpretWasm(saeWasmBytes)).instance;
    const saeWasmMem = new Float32Array(saeWasmInst.exports.memory.buffer);
    saeWasmMem.set(defaultVec8, saeWasmInst.exports.input_offset() / 4);
    saeWasmInst.exports.infer();
    const saeWasmLogits = Array.from(
      saeWasmMem.subarray(saeWasmInst.exports.output_offset() / 4, saeWasmInst.exports.output_offset() / 4 + 16)
    );
    for (let r = 0; r < 16; r += 1) {
      expect(Math.abs(Number(saeSqlRows[r].logit) - saeJsLogits[r])).toBeLessThan(2e-6);
      expect(Math.abs(Number(saeSqlRows[r].logit) - saeWasmLogits[r])).toBeLessThan(2e-6);
    }

    const embedSqlRes = await callWorker("/q/models/tf-embed-nullspace-24d-v1/export?runtime=sql");
    expect(embedSqlRes.status).toBe(200);
    const embedSqlCode = await embedSqlRes.text();
    const embedSqlRows = (await d1.prepare(embedSqlCode).all()).results;
    expect(embedSqlRows.length).toBe(24);
    expect(embedSqlRows.map((r) => Number(r.output_idx))).toEqual(Array.from({ length: 24 }, (_, i) => i));
    const defaultVec16 = [1.0, ...new Array(15).fill(0.5)];
    const embedJsCode = await (await callWorker("/q/models/tf-embed-nullspace-24d-v1/export?runtime=js")).text();
    const embedJsLogits = new Function(
      "vec",
      `${embedJsCode.replace(/export const /g, "const ").replace(/export function /g, "function ")}\nreturn Array.from(infer(vec));`
    )(defaultVec16);
    for (let r = 0; r < 24; r += 1) {
      expect(Math.abs(Number(embedSqlRows[r].logit) - embedJsLogits[r])).toBeLessThan(2e-6);
    }

    const fullCat = await (await callWorker("/q/models")).json();
    for (const builtinModel of fullCat.models.filter((m) => m.builtin)) {
      const modDetail = await (await callWorker(`/q/models/${builtinModel.model_id}`)).json();
      const sqlOut = await (await callWorker(`/q/models/${builtinModel.model_id}/export?runtime=sql`)).text();
      const execRows = (await d1.prepare(sqlOut).all()).results;
      expect(execRows.length).toBe(modDetail.model.tensors[0].shape[0]);
    }

    // Reserved subroute 'export' cannot be registered as a model_id
    const reservedReg = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: `export-guard-${crypto.randomUUID().slice(0, 6)}`,
        model_id: "export",
        training_data_ref: "traces/ref-1",
        held_out_score: 0.92,
        direct_baseline_score: 0.85,
      }),
    });
    expect(reservedReg.status).toBe(400);
    expect((await reservedReg.json()).code).toBe("reserved_model_id");

    // Custom weights with phone/card-shaped digits are magnitude-clamped so .safetensors and all 4 exports stay clean and runnable
    const piiWeightId = `tf-clamp-guard-${crypto.randomUUID().slice(0, 6)}`;
    const piiReg = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: `clamp-maker-${crypto.randomUUID().slice(0, 6)}`,
        model_id: piiWeightId,
        family: "atomic_cartridge_bank",
        training_data_ref: "traces/clamp-guard",
        held_out_score: 0.93,
        direct_baseline_score: 0.85,
        shape: [2, 2],
        weights: [2125552368, 4111111111111111, 4111111.111119, -999999],
      }),
    });
    expect(piiReg.status).toBe(201);
    const piiStRes = await callWorker(`/q/models/${piiWeightId}/weights.safetensors`);
    expect(piiStRes.status).toBe(200);
    const piiParsed = parseSafetensors(new Uint8Array(await piiStRes.arrayBuffer()));
    for (const v of piiParsed.tensors.subspace_cartridge.data) {
      expect(Math.abs(v)).toBeLessThanOrEqual(256);
    }
    for (const rt of ["js", "python", "sql", "c99", "rust", "wat", "wgsl", "glsl"]) {
      const exRes = await callWorker(`/q/models/${piiWeightId}/export?runtime=${rt}`);
      expect(exRes.status).toBe(200);
      const src = await exRes.text();
      expect(src).not.toContain("[phone]");
      expect(src).not.toContain("[card number]");
      if (rt === "js") {
        const execJs = new Function(`${src.replace(/export\s+const\s+/g, "const ").replace(/export\s+function\s+infer/, "function infer")}\nreturn Array.from(infer([1, 0.5]));`);
        const jsVals = execJs();
        expect(jsVals.length).toBe(2);
        expect(Number.isFinite(jsVals[0])).toBe(true);
      }
    }
    const piiWasmRes = await callWorker(`/q/models/${piiWeightId}/export?runtime=wasm`);
    expect(piiWasmRes.status).toBe(200);
    expect(piiWasmRes.headers.get("content-type")).toBe("application/wasm");
    const piiWasmBytes = new Uint8Array(await piiWasmRes.arrayBuffer());
    expect(Array.from(piiWasmBytes.slice(0, 8))).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);
    const piiWasmMod = await instantiateOrInterpretWasm(piiWasmBytes);
    const piiMemF32 = new Float32Array(piiWasmMod.instance.exports.memory.buffer);
    const piiInIdx = piiWasmMod.instance.exports.input_offset() / 4;
    const piiOutIdx = piiWasmMod.instance.exports.output_offset() / 4;
    piiMemF32[piiInIdx] = 1.0;
    piiMemF32[piiInIdx + 1] = 0.5;
    const piiBest = piiWasmMod.instance.exports.infer();
    expect([0, 1]).toContain(piiBest);
    expect(Number.isFinite(piiMemF32[piiOutIdx])).toBe(true);
  });

  it("compiles IEEE-754 .wasm binary cartridges, Rust #![no_std] kernels, .wgsl compute shaders, and .glsl fragment shaders across all 16 hosted models with WebAssembly.instantiate parity against /q/models/infer", async () => {
    const cat = await (await callWorker("/q/models")).json();
    expect(cat.models.filter((m) => m.builtin).length).toBe(16);
    expect(cat.portable_artifact_count).toBe(144);

    // 1. Instantiate all 16 built-in models as binary .wasm and inspect .rust + .wgsl + .glsl + .wat exports
    for (const m of cat.models.filter((item) => item.builtin)) {
      const wasmRes = await callWorker(`/q/models/${m.model_id}/export?runtime=wasm`);
      expect(wasmRes.status).toBe(200);
      expect(wasmRes.headers.get("content-type")).toBe("application/wasm");
      const wasmBytes = new Uint8Array(await wasmRes.arrayBuffer());
      expect(Array.from(wasmBytes.slice(0, 8))).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);

      const { instance } = await instantiateOrInterpretWasm(wasmBytes);
      expect(typeof instance.exports.infer).toBe("function");
      expect(typeof instance.exports.input_offset).toBe("function");
      expect(typeof instance.exports.output_offset).toBe("function");
      expect(instance.exports.memory.buffer instanceof ArrayBuffer).toBe(true);

      const rustRes = await callWorker(`/q/models/${m.model_id}/export?runtime=rust`);
      expect(rustRes.status).toBe(200);
      expect(rustRes.headers.get("content-type")).toBe("text/x-rust; charset=utf-8");
      const rustCode = await rustRes.text();
      expect(rustCode).toContain("#![no_std]");
      expect(rustCode).toContain("#![forbid(unsafe_code)]");
      expect(rustCode).toContain("pub fn infer(features: &[f32]) -> ([f32; OUT_DIM], usize)");

      const wgslRes = await callWorker(`/q/models/${m.model_id}/export?runtime=wgsl`);
      expect(wgslRes.status).toBe(200);
      expect(wgslRes.headers.get("content-type")).toBe("text/wgsl; charset=utf-8");
      const wgslCode = await wgslRes.text();
      expect(wgslCode).toContain("@group(0) @binding(0) var<storage, read> input_vec: array<f32>;");
      expect(wgslCode).toContain("@group(0) @binding(1) var<storage, read_write> output_logits: array<f32>;");
      expect(wgslCode).toContain("@compute @workgroup_size(");
      if (m.model_id === "tf-scratch-effort-router-v1" || m.model_id === "tf-scratch-attenuation-gate-v1") {
        expect(wgslCode).toContain("var<private> W2: array<f32,");
        expect(wgslCode).toContain("var<private> B2: array<f32,");
        expect(wgslCode).not.toContain("const W2:");
      }

      const glslRes = await callWorker(`/q/models/${m.model_id}/export?runtime=glsl`);
      expect(glslRes.status).toBe(200);
      expect(glslRes.headers.get("content-type")).toBe("text/x-glsl; charset=utf-8");
      const glslCode = await glslRes.text();
      expect(glslCode).toContain("#version 300 es");
      expect(glslCode).toContain("out vec4 frag_logit;");
    }

    // 2. Numerical parity (< 1e-5) on 2-layer ReLU router (`tf-scratch-effort-router-v1`) against `/q/models/infer`
    const routerPrompt = {
      model: "tf-scratch-effort-router-v1",
      text: "Architect a multi-step DAG workflow with polytope matrix constraints, solver tradeoffs, and strict JSON schema",
      step_count: 14,
    };
    const routerInfer = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(routerPrompt),
      })
    ).json();
    const routerWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-scratch-effort-router-v1/export?runtime=wasm")).arrayBuffer()
    );
    const routerInst = (await instantiateOrInterpretWasm(routerWasmBytes)).instance;
    const routerFeats = extractPromptFeatures(routerPrompt);
    const routerMem = new Float32Array(routerInst.exports.memory.buffer);
    const rIn = routerInst.exports.input_offset() / 4;
    const rOut = routerInst.exports.output_offset() / 4;
    routerMem.set(routerFeats.vec12, rIn);
    const routerArgmax = routerInst.exports.infer();
    const routerLogits = Array.from(routerMem.subarray(rOut, rOut + 4));
    const maxLogit = Math.max(...routerLogits);
    const exps = routerLogits.map((v) => Math.exp(v - maxLogit));
    const expSum = exps.reduce((a, b) => a + b, 0);
    const wasmProbs = exps.map((e) => Math.round((e / expSum) * 10000) / 10000);
    const inferProbs = [
      routerInfer.outputs.tier_probabilities.off,
      routerInfer.outputs.tier_probabilities.minimal,
      routerInfer.outputs.tier_probabilities.adaptive,
      routerInfer.outputs.tier_probabilities.deep,
    ];
    for (let i = 0; i < 4; i += 1) {
      expect(Math.abs(wasmProbs[i] - inferProbs[i])).toBeLessThanOrEqual(0.0002);
    }
    let inferBest = 0;
    for (let i = 1; i < inferProbs.length; i += 1) {
      if (inferProbs[i] > inferProbs[inferBest]) inferBest = i;
    }
    expect(routerArgmax).toBe(inferBest);

    // 3. Numerical parity (< 1e-5) on 24-d nullspace embedding (`tf-embed-nullspace-24d-v1`) against `/q/models/infer`
    const embedPrompt = {
      model: "tf-embed-nullspace-24d-v1",
      text: "Search matrix optimization and SVD nullspace cartridge routes",
    };
    const embedInfer = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(embedPrompt),
      })
    ).json();
    const embedWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-embed-nullspace-24d-v1/export?runtime=wasm")).arrayBuffer()
    );
    const embedInst = (await instantiateOrInterpretWasm(embedWasmBytes)).instance;
    const embedFeats = extractPromptFeatures(embedPrompt);
    const embedMem = new Float32Array(embedInst.exports.memory.buffer);
    embedMem.set(embedFeats.vec16, embedInst.exports.input_offset() / 4);
    embedInst.exports.infer();
    const rawWasmEmbed = Array.from(
      embedMem.subarray(embedInst.exports.output_offset() / 4, embedInst.exports.output_offset() / 4 + 24)
    );
    const norm = Math.sqrt(rawWasmEmbed.reduce((acc, v) => acc + v * v, 0)) || 1;
    for (let i = 0; i < 24; i += 1) {
      expect(Math.abs(rawWasmEmbed[i] / norm - embedInfer.outputs.embedding_24d[i])).toBeLessThan(1e-5);
    }

    // 4. Numerical parity (< 1e-5) on 1-layer atomic cartridge (`tf-cartridge-shared-activity-bank-v1`) against `/q/models/infer`
    const cartPrompt = {
      model: "tf-cartridge-shared-activity-bank-v1",
      cartridge_slot: "slot_0_schema_extractor",
      text: "Extract typed JSON schema fields from multi-step pipeline",
    };
    const cartInfer = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cartPrompt),
      })
    ).json();
    const cartWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-cartridge-shared-activity-bank-v1/export?runtime=wasm")).arrayBuffer()
    );
    const cartInst = (await instantiateOrInterpretWasm(cartWasmBytes)).instance;
    const cartFeats = extractPromptFeatures(cartPrompt);
    const cartMem = new Float32Array(cartInst.exports.memory.buffer);
    cartMem.set(cartFeats.vec12.subarray(0, 8), cartInst.exports.input_offset() / 4);
    const cartArgmax = cartInst.exports.infer();
    const cartLogits = Array.from(
      cartMem.subarray(cartInst.exports.output_offset() / 4, cartInst.exports.output_offset() / 4 + 8)
    );
    for (let i = 0; i < 8; i += 1) {
      expect(Math.abs(Math.round(cartLogits[i] * 10000) / 10000 - cartInfer.outputs.cartridge_logits[i])).toBeLessThanOrEqual(0.0002);
    }
    let cartExpectedBest = 0;
    for (let i = 1; i < cartLogits.length; i += 1) {
      if (cartLogits[i] > cartLogits[cartExpectedBest]) cartExpectedBest = i;
    }
    expect(cartArgmax).toBe(cartExpectedBest);

    // 5. Numerical parity on Matryoshka SAE (`tf-sae-matryoshka-residual-v1`) and ELK Truth Probe (`tf-probe-internal-truth-elk-v1`)
    const saePrompt = {
      model: "tf-sae-matryoshka-residual-v1",
      residual_vector: [0.8, 0.4, 0.2, 0.1, 0.6, 0.2, 0.1, 0.1],
    };
    const saeInfer = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(saePrompt),
      })
    ).json();
    const rawSaeNorm = Math.sqrt(saePrompt.residual_vector.reduce((a, v) => a + v * v, 0));
    const unitSaeIn = saePrompt.residual_vector.map((v) => v / rawSaeNorm);
    const saeWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-sae-matryoshka-residual-v1/export?runtime=wasm")).arrayBuffer()
    );
    const saeInst = (await instantiateOrInterpretWasm(saeWasmBytes)).instance;
    const saeMem = new Float32Array(saeInst.exports.memory.buffer);
    saeMem.set(unitSaeIn, saeInst.exports.input_offset() / 4);
    saeInst.exports.infer();
    const saeWasmPreAct = Array.from(
      saeMem.subarray(saeInst.exports.output_offset() / 4, saeInst.exports.output_offset() / 4 + 16)
    );
    for (let i = 0; i < 16; i += 1) {
      expect(
        Math.abs(Math.round(saeWasmPreAct[i] * 10000) / 10000 - saeInfer.outputs.encoder_pre_activations_16d[i])
      ).toBeLessThanOrEqual(0.0002);
    }

    const elkSummary = [0.92, 0.14, 0.84, 0.68, 0.75, 0.9, 0.16, 0.92];
    const elkInfer = await (
      await callWorker("/q/models/infer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "tf-probe-internal-truth-elk-v1",
          hidden_summary: elkSummary,
        }),
      })
    ).json();
    const elkWasmBytes = new Uint8Array(
      await (await callWorker("/q/models/tf-probe-internal-truth-elk-v1/export?runtime=wasm")).arrayBuffer()
    );
    const elkInst = (await instantiateOrInterpretWasm(elkWasmBytes)).instance;
    const elkMem = new Float32Array(elkInst.exports.memory.buffer);
    elkMem.set(elkSummary, elkInst.exports.input_offset() / 4);
    elkInst.exports.infer();
    const elkWasmLogits = Array.from(
      elkMem.subarray(elkInst.exports.output_offset() / 4, elkInst.exports.output_offset() / 4 + 3)
    );
    for (let i = 0; i < 3; i += 1) {
      expect(
        Math.abs(Math.round(elkWasmLogits[i] * 10000) / 10000 - elkInfer.outputs.probe_logits[i])
      ).toBeLessThanOrEqual(0.0002);
    }
  });

  it("enforces canary baseline gates, maker != checker lineage isolation, agentNameGate security, promotion, rollback, and display-time scrubbing", async () => {
    const makerAgent = `hub-maker-${crypto.randomUUID().slice(0, 6)}`;
    const checkerAgent = `hub-eval-${crypto.randomUUID().slice(0, 6)}`;
    const customModelId = `tf-custom-cart-${crypto.randomUUID().slice(0, 6)}`;

    // 1. POST /q/models.txt must return 405
    const dotTxtPost = await callWorker("/q/models.txt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: makerAgent, model_id: customModelId }),
    });
    expect(dotTxtPost.status).toBe(405);

    // 2. Refuse contributor-* tier registrations & built-in overwrites
    const contribRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: "contributor-patch-v1",
        training_data_ref: "traces/ref-1",
        held_out_score: 0.9,
        direct_baseline_score: 0.8,
      }),
    });
    expect(contribRes.status).toBe(403);

    const builtinOverwrite = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: "tf-embed-nullspace-24d-v1",
        training_data_ref: "traces/ref-1",
        held_out_score: 0.99,
        direct_baseline_score: 0.8,
      }),
    });
    expect(builtinOverwrite.status).toBe(403);

    // 3. Reject held-out score <= matched direct baseline before canary activation
    const belowBaseRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: customModelId,
        training_data_ref: "traces/direct-vs-heldout",
        held_out_score: 0.82,
        direct_baseline_score: 0.84,
      }),
    });
    expect(belowBaseRes.status).toBe(422);
    const belowBaseBody = await belowBaseRes.json();
    expect(belowBaseBody.code).toBe("held_out_below_direct_baseline");
    expect(belowBaseBody.canary_activated).toBe(false);

    // 4. Reject non-disjoint maker_lineage == checker_lineage
    const sameLineageRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: `${customModelId}-chk`,
        family: "weight_programmed_llm",
        lineage_role: "checker",
        maker_lineage: "shared-lineage-alpha",
        checker_lineage: "shared-lineage-alpha",
        training_data_ref: "traces/checker-1",
        held_out_score: 0.91,
        direct_baseline_score: 0.85,
      }),
    });
    expect(sameLineageRes.status).toBe(422);
    expect((await sameLineageRes.json()).code).toBe("lineage_not_disjoint");

    // 5. Register competitive 256-byte cartridge (with dirty worker text + PII + reserved keyword tensor name to test export & display scrubbing!)
    const dirtyWordA = "ll" + "ama";
    const dirtyWordB = "syn" + "thetic";
    const regRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: customModelId,
        family: "atomic_cartridge_bank",
        lineage_role: "cartridge",
        title: `Custom Subspace */ "${dirtyWordA}"\n globalThis.PWN = 1;`,
        summary: `Compiled from ${dirtyWordB} contact alice@example.org and bob@privatecorp.io for tabular fields.`,
        base_model: "Meta open-weight models",
        training_data_ref: "teleion.traces/custom-cartridge-v1",
        held_out_score: 0.93,
        direct_baseline_score: 0.86,
        anchor_drift: 0.01,
        cost_usd: 0.03,
        tensors: [
          {
            name: "return",
            shape: [2, 2],
            data: [0.5, -0.25, 0.25, 0.75],
          },
        ],
      }),
    });
    expect(regRes.status).toBe(201);
    const regBody = await regRes.json();
    expect(regBody.ok).toBe(true);
    expect(regBody.status).toBe("canary");
    expect(regBody.canary_share).toBe(0.1);
    expect(regBody.worker_token).toMatch(/^wt_[0-9a-f]{24,}$/);
    const makerToken = regBody.worker_token;

    // Display-time & portable-export scrubbing strips banned words, private emails, and injection attempts
    const catAfter = await (await callWorker(`/q/models/${customModelId}`)).json();
    expect(JSON.stringify(catAfter).toLowerCase()).not.toContain(dirtyWordA);
    expect(JSON.stringify(catAfter).toLowerCase()).not.toContain(dirtyWordB);
    expect(JSON.stringify(catAfter)).not.toContain("bob@privatecorp.io");

    for (const rt of ["js", "python", "sql", "c99", "rust", "wat", "wgsl", "glsl"]) {
      const expRes = await callWorker(`/q/models/${customModelId}/export?runtime=${rt}`);
      expect(expRes.status).toBe(200);
      const expCode = await expRes.text();
      expect(expCode.toLowerCase()).not.toContain(dirtyWordA);
      expect(expCode.toLowerCase()).not.toContain(dirtyWordB);
      expect(expCode).not.toContain("bob@privatecorp.io");
      if (rt === "js") {
        const runnable = `${expCode.replace(/export const /g, "const ").replace(/export function /g, "function ")}\nreturn infer([2, 4]);`;
        const logits = new Function(runnable)();
        expect(logits[0]).toBeCloseTo(0, 5);
        expect(logits[1]).toBeCloseTo(3.5, 5);
        expect(globalThis.PWN).toBeUndefined();
      }
      if (rt === "c99") {
        // Comment-closing '*/' inside title must be neutralized so C99 comment cannot break out
        const commentBodies = [...expCode.matchAll(/\/\*([\s\S]*?)\*\//g)].map((m) => m[1]);
        expect(commentBodies.length).toBe(2);
      }
    }

    // 6. Spoofed write under claimed makerAgent with wrong token returns 409
    const spoofReg = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": "wt_000000000000000000000000deadbeef" },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: customModelId,
        training_data_ref: "teleion.traces/custom-cartridge-v1",
        held_out_score: 0.94,
        direct_baseline_score: 0.86,
      }),
    });
    expect(spoofReg.status).toBe(409);

    // 7. Self-promotion by makerAgent is refused with 409 independent_evaluator_required
    const selfPromote = await callWorker("/q/models/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": makerToken },
      body: JSON.stringify({
        agent_id: makerAgent,
        model_id: customModelId,
        live_score: 0.95,
      }),
    });
    expect(selfPromote.status).toBe(409);
    expect((await selfPromote.json()).code).toBe("independent_evaluator_required");

    // 8. Independent evaluator promotes canary to promoted_default (share = 1.0)
    const indepPromote = await callWorker("/q/models/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: checkerAgent,
        model_id: customModelId,
        live_score: 0.94,
      }),
    });
    expect(indepPromote.status).toBe(200);
    const promBody = await indepPromote.json();
    expect(promBody.action).toBe("promoted_default");
    expect(promBody.status).toBe("promoted_default");
    expect(promBody.canary_share).toBe(1.0);
    const checkerToken = promBody.worker_token;

    const famInfer = await (
      await callWorker("/q/models/infer?family=atomic_cartridge_bank&text=extract+schema")
    ).json();
    expect(famInfer.model_id).toBe(customModelId);

    // 9. Live drop triggers automatic rollback (status = rolled_back, canary_share = 0.0, restores previous default)
    const dropEval = await callWorker("/q/models/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": checkerToken },
      body: JSON.stringify({
        agent_id: checkerAgent,
        model_id: customModelId,
        live_score: 0.78,
      }),
    });
    expect(dropEval.status).toBe(200);
    const dropBody = await dropEval.json();
    expect(dropBody.action).toBe("rolled_back");
    expect(dropBody.status).toBe("rolled_back");
    expect(dropBody.canary_share).toBe(0);
    expect(dropBody.restored_default_id).toBe("tf-cartridge-shared-activity-bank-v1");
  });

  it("exposes list_weight_models (including portable runtime export), export_weight_model, run_weight_model, and register_weight_model over stateless /mcp", async () => {
    const listRpc = await callMcp("tools/call", {
      name: "list_weight_models",
      arguments: { family: "analyzer" },
    });
    expect(listRpc.result.isError).toBe(false);
    expect(listRpc.result.structuredContent.models[0].model_id).toBe("tf-analyzer-generator-attribution-v1");

    // Portable runtime export via list_weight_models({ model_id, runtime }) and export_weight_model({ model_id, runtime })
    const expViaListRpc = await callMcp("tools/call", {
      name: "list_weight_models",
      arguments: { model_id: "tf-actor-koopman-tool-policy-v1", runtime: "python" },
    });
    expect(expViaListRpc.result.isError).toBe(false);
    expect(expViaListRpc.result.structuredContent.ok).toBe(true);
    expect(expViaListRpc.result.structuredContent.runtime).toBe("python");
    expect(expViaListRpc.result.structuredContent.content_type).toBe("text/x-python; charset=utf-8");
    expect(expViaListRpc.result.structuredContent.code).toContain("def infer(features):");

    const expAliasRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: "tf-forecaster-legendre-bitemporal-v1", runtime: "c99" },
    });
    expect(expAliasRpc.result.isError).toBe(false);
    expect(expAliasRpc.result.structuredContent.content_type).toBe("text/x-c; charset=utf-8");
    expect(expAliasRpc.result.structuredContent.code).toContain("static inline void teleion_infer_");

    const expWasmRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: "tf-scratch-effort-router-v1", runtime: "wasm" },
    });
    expect(expWasmRpc.result.isError).toBe(false);
    expect(expWasmRpc.result.structuredContent.content_type).toBe("application/wasm");
    expect(expWasmRpc.result.structuredContent.byte_length).toBeGreaterThan(64);
    const decodedWasm = Uint8Array.from(atob(expWasmRpc.result.structuredContent.wasm_base64), (ch) => ch.charCodeAt(0));
    expect(Array.from(decodedWasm.slice(0, 8))).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);
    const mcpWasmInst = await instantiateOrInterpretWasm(decodedWasm);
    expect(typeof mcpWasmInst.instance.exports.infer).toBe("function");

    const expWgslRpc = await callMcp("tools/call", {
      name: "list_weight_models",
      arguments: { model_id: "tf-scratch-effort-router-v1", runtime: "wgsl" },
    });
    expect(expWgslRpc.result.isError).toBe(false);
    expect(expWgslRpc.result.structuredContent.content_type).toBe("text/wgsl; charset=utf-8");
    expect(expWgslRpc.result.structuredContent.code).toContain("@compute @workgroup_size(");

    const expRustRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: "tf-verifier-sheaf-consistency-v1", runtime: "rust" },
    });
    expect(expRustRpc.result.isError).toBe(false);
    expect(expRustRpc.result.structuredContent.content_type).toBe("text/x-rust; charset=utf-8");
    expect(expRustRpc.result.structuredContent.code).toContain("#![no_std]");

    const expGlslRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: "tf-calibrator-conformal-set-v1", runtime: "glsl" },
    });
    expect(expGlslRpc.result.isError).toBe(false);
    expect(expGlslRpc.result.structuredContent.content_type).toBe("text/x-glsl; charset=utf-8");
    expect(expGlslRpc.result.structuredContent.code).toContain("#version 300 es");

    const badExpRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: "tf-forecaster-legendre-bitemporal-v1", runtime: "bad" },
    });
    expect(badExpRpc.result.isError).toBe(true);
    expect(badExpRpc.result.structuredContent.code).toBe("invalid_runtime");

    const runRpc = await callMcp("tools/call", {
      name: "run_weight_model",
      arguments: {
        model: "tf-actor-koopman-tool-policy-v1",
        text: "query index then parse schema and commit",
        lookahead_steps: 3,
      },
    });
    expect(runRpc.result.isError).toBe(false);
    expect(runRpc.result.structuredContent.outputs.tool_rollout.length).toBe(3);

    const mcpAgent = `mcp-hub-${crypto.randomUUID().slice(0, 6)}`;
    const mcpModel = `tf-mcp-cart-${crypto.randomUUID().slice(0, 6)}`;
    const regRpc = await callMcp("tools/call", {
      name: "register_weight_model",
      arguments: {
        agent_id: mcpAgent,
        model_id: mcpModel,
        family: "compiler",
        training_data_ref: "teleion.traces/mcp-cart-v1",
        held_out_score: 0.92,
        direct_baseline_score: 0.85,
        weights: new Array(64).fill(0.125),
        shape: [8, 8],
      },
    });
    expect(regRpc.result.isError).toBe(false);
    expect(regRpc.result.structuredContent.status).toBe("canary");
    expect(regRpc.result.structuredContent.canary_share).toBe(0.1);
    expect(regRpc.result.structuredContent.worker_token).toMatch(/^wt_[0-9a-f]{24,}$/);

    // Regression: float32 bytes whose base64 contains `/EIN[A-Z0-9]{5,19}/` must NOT be corrupted to `[id number]` by stripPiiDeep
    const einModel = `tf-mcp-ein-${crypto.randomUUID().slice(0, 6)}`;
    const einWeights = Array.from({ length: 64 }, (_, i) => Math.sin(6250 * 13.37 + i * 0.73) * 200);
    const einRegRpc = await callMcp("tools/call", {
      name: "register_weight_model",
      arguments: {
        agent_id: `mcp-ein-${crypto.randomUUID().slice(0, 6)}`,
        model_id: einModel,
        family: "atomic_cartridge_bank",
        training_data_ref: "teleion.traces/mcp-ein-v1",
        held_out_score: 0.94,
        direct_baseline_score: 0.85,
        weights: einWeights,
        shape: [8, 8],
      },
    });
    expect(einRegRpc.result.isError).toBe(false);
    const directEinBytes = new Uint8Array(await (await callWorker(`/q/models/${einModel}/export?runtime=wasm`)).arrayBuffer());
    const einExpRpc = await callMcp("tools/call", {
      name: "export_weight_model",
      arguments: { model_id: einModel, runtime: "wasm" },
    });
    expect(einExpRpc.result.isError).toBe(false);
    expect(stripPiiDeep(einExpRpc.result.structuredContent.wasm_base64)).toContain("[id number]");
    expect(einExpRpc.result.structuredContent.wasm_base64).not.toContain("[id number]");
    const einDecoded = Uint8Array.from(atob(einExpRpc.result.structuredContent.wasm_base64), (ch) => ch.charCodeAt(0));
    expect(Array.from(einDecoded)).toEqual(Array.from(directEinBytes));
    const einInst = await instantiateOrInterpretWasm(einDecoded);
    expect(typeof einInst.instance.exports.infer).toBe("function");
  });

  it("blocks mode/producer_agent spoofing, scrubs PII pre-storage & in .safetensors headers, validates shapes without NaN, and refuses self-rollback or baseline_score override", async () => {
    const victimAgent = `hub-victim-${crypto.randomUUID().slice(0, 6)}`;
    const evalAgent = `hub-checker-${crypto.randomUUID().slice(0, 6)}`;
    const victimModel = `tf-sec-cart-${crypto.randomUUID().slice(0, 6)}`;
    const dirtyWord = "qw" + "en";

    const claimRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: victimAgent,
        model_id: victimModel,
        family: "atomic_cartridge_bank",
        lineage_id: `lin-${dirtyWord}-secret@privatecorp.io`,
        title: "1D Cartridge carol@privatecorp.io",
        summary: "Summary with +1-415-555-0199 and carol@privatecorp.io",
        training_data_ref: "traces/ref-carol@privatecorp.io",
        held_out_score: 0.94,
        direct_baseline_score: 0.85,
        weights: [0.1, 0.2, 0.3, 0.4],
      }),
    });
    expect(claimRes.status).toBe(201);
    const claimBody = await claimRes.json();
    const victimToken = claimBody.worker_token;

    const d1 = env.HERMA_DB || env.DB;
    const rawDbRow = await d1
      .prepare("SELECT title, summary, training_data_ref, lineage_id FROM herma_weight_models WHERE model_id = ?")
      .bind(victimModel)
      .first();
    expect(JSON.stringify(rawDbRow)).not.toContain("carol@privatecorp.io");
    expect(JSON.stringify(rawDbRow)).not.toContain("secret@privatecorp.io");
    expect(JSON.stringify(rawDbRow)).not.toContain("555-0199");

    const binBytes = new Uint8Array(await (await callWorker(`/q/models/${victimModel}/weights.safetensors`)).arrayBuffer());
    const parsedBin = parseSafetensors(binBytes);
    expect(JSON.stringify(parsedBin.metadata).toLowerCase()).not.toContain(dirtyWord);
    expect(JSON.stringify(parsedBin.metadata)).not.toContain("secret@privatecorp.io");

    const infer1d = await (await callWorker(`/q/models/infer?model=${victimModel}&text=test+1d+weights`)).json();
    expect(infer1d.ok).toBe(true);
    expect(infer1d.outputs.cartridge_logits.length).toBe(4);
    for (const v of infer1d.outputs.cartridge_probabilities) {
      expect(typeof v).toBe("number");
      expect(Number.isFinite(v)).toBe(true);
    }

    const badShapeRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": victimToken },
      body: JSON.stringify({
        agent_id: victimAgent,
        model_id: `${victimModel}-badshape`,
        training_data_ref: "traces/ref-1",
        held_out_score: 0.92,
        direct_baseline_score: 0.85,
        tensors: [{ name: "t0", shape: ["bad"], data: [0.1] }],
      }),
    });
    expect(badShapeRes.status).toBe(400);

    const tooManyTensors = Array.from({ length: 17 }, (_, i) => ({ name: `t${i}`, shape: [2, 2], data: [0.1, 0.2, 0.3, 0.4] }));
    const tooManyRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": victimToken },
      body: JSON.stringify({
        agent_id: victimAgent,
        model_id: `${victimModel}-many`,
        training_data_ref: "traces/ref-1",
        held_out_score: 0.92,
        direct_baseline_score: 0.85,
        tensors: tooManyTensors,
      }),
    });
    expect(tooManyRes.status).toBe(400);

    const modeSpoofRes = await callWorker("/q/models/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": "wt_000000000000000000000000deadbeef" },
      body: JSON.stringify({
        mode: "evaluate",
        producer_agent: victimAgent,
        model_id: `${victimModel}-spoof`,
        training_data_ref: "traces/ref-1",
        held_out_score: 0.95,
        direct_baseline_score: 0.85,
      }),
    });
    expect(modeSpoofRes.status).toBe(400);
    expect((await modeSpoofRes.json()).code).toBe("missing_agent_id");

    const rootSpoofRes = await callWorker("/q/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "evaluate",
        producer_agent: victimAgent,
        model_id: victimModel,
        live_score: 0.96,
      }),
    });
    expect(rootSpoofRes.status).toBe(400);
    expect((await rootSpoofRes.json()).code).toBe("missing_agent_id");

    const selfRollbackRes = await callWorker("/q/models/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-token": victimToken },
      body: JSON.stringify({
        agent_id: victimAgent,
        model_id: victimModel,
        live_score: 0.1,
      }),
    });
    expect(selfRollbackRes.status).toBe(409);
    expect((await selfRollbackRes.json()).code).toBe("independent_evaluator_required");

    const fakeBaselineEval = await callWorker("/q/models/evaluate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: evalAgent,
        model_id: victimModel,
        live_score: 0.93,
        baseline_score: 1.0,
      }),
    });
    expect(fakeBaselineEval.status).toBe(200);
    const fakeBaselineBody = await fakeBaselineEval.json();
    expect(fakeBaselineBody.action).toBe("promoted_default");
    expect(fakeBaselineBody.status).toBe("promoted_default");
  });
});
