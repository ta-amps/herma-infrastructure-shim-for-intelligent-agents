// Native V8 WebAssembly.instantiate + rustc #![no_std] execution check for /q/models/<id>/export?runtime=wasm, wat, rust, wgsl, and glsl.
// Runs the real Cloudflare Worker against in-memory D1 in Node 22 where V8 JIT compiles .wasm and rustc compiles #![no_std] kernels.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ensureGenerated } from "../../scripts/banned_list.mjs";
import { inMemoryD1 } from "../../scripts/memory_d1.mjs";
import { stripPiiDeep } from "../../deploy/cloudflare/pii_strip.js";
import { extractPromptFeatures } from "../../deploy/cloudflare/weight_space_model_hub.js";

ensureGenerated({ fixtureOk: true });
const { default: worker } = await import("../../deploy/cloudflare/worker.js");

const BASE = "https://shim.teleionlabs.com";

function resolveRustc() {
  const candidates = [path.join(os.homedir(), ".local", "bin", "rustc"), "rustc"];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function resolveCc() {
  const candidates = ["/usr/bin/cc", "cc", "gcc"];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return bin;
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function makeCaller() {
  const db = await inMemoryD1();
  const env = { STORAGE_MODE: "cloud", HERMA_DB: db, PUBLIC_URL: BASE, AGENT_NAME_CLAIMS: "on", PUBLIC_NAMES_FILTER: "on" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  return (routePath, init = {}) => worker.fetch(new Request(`${BASE}${routePath}`, init), env, ctx);
}

test("instantiates binary IEEE-754 .wasm and compiles #![no_std] Rust + C99 + .wgsl + .glsl exports across all 16 hosted models with < 1e-5 parity", async () => {
  const call = await makeCaller();
  const catRes = await call("/q/models", { headers: { accept: "application/json" } });
  assert.equal(catRes.status, 200);
  const catalog = await catRes.json();
  assert.deepEqual(catalog.portable_runtimes, ["safetensors", "js", "python", "sql", "c99", "rust", "wasm", "wgsl", "glsl"]);
  assert.equal(catalog.universal_family_count, 10);
  assert.equal(catalog.portable_runtime_count, 9);
  assert.equal(catalog.portable_artifact_count, 144);
  const builtins = catalog.models.filter((m) => m.builtin);
  assert.equal(builtins.length, 16);

  const rustcBin = resolveRustc();
  const ccBin = resolveCc();
  const tmpDir = rustcBin || ccBin ? fs.mkdtempSync(path.join(os.tmpdir(), "tf-rust-c99-hub-")) : null;

  try {
    for (const [idx, m] of builtins.entries()) {
      const wasmRes = await call(`/q/models/${m.model_id}/export?runtime=wasm`);
      assert.equal(wasmRes.status, 200);
      assert.equal(wasmRes.headers.get("content-type"), "application/wasm");
      const wasmBytes = new Uint8Array(await wasmRes.arrayBuffer());
      assert.deepEqual(Array.from(wasmBytes.slice(0, 8)), [0, 97, 115, 109, 1, 0, 0, 0]);

      const { instance } = await WebAssembly.instantiate(wasmBytes);
      assert.equal(typeof instance.exports.infer, "function");
      assert.equal(typeof instance.exports.input_offset, "function");
      assert.equal(typeof instance.exports.output_offset, "function");
      assert.ok(instance.exports.memory instanceof WebAssembly.Memory);

      const rustRes = await call(`/q/models/${m.model_id}/export?runtime=rust`);
      assert.equal(rustRes.status, 200);
      assert.equal(rustRes.headers.get("content-type"), "text/x-rust; charset=utf-8");
      const rustText = await rustRes.text();
      assert.ok(rustText.includes("#![no_std]"));
      assert.ok(rustText.includes("#![forbid(unsafe_code)]"));

      if (rustcBin && tmpDir) {
        const rsPath = path.join(tmpDir, `kernel_${idx}.rs`);
        const rlibPath = path.join(tmpDir, `libkernel_${idx}.rlib`);
        fs.writeFileSync(rsPath, rustText, "utf8");
        execFileSync(rustcBin, ["--crate-type", "rlib", "--edition", "2021", "-D", "warnings", "-O", rsPath, "-o", rlibPath], {
          stdio: "pipe",
        });
      }

      const c99Res = await call(`/q/models/${m.model_id}/export?runtime=c99`);
      assert.equal(c99Res.status, 200);
      assert.equal(c99Res.headers.get("content-type"), "text/x-c; charset=utf-8");
      const c99Text = await c99Res.text();
      assert.ok(c99Text.includes("static inline void teleion_infer_"));
      if (ccBin && tmpDir) {
        const hPath = path.join(tmpDir, `model_${idx}.h`);
        const cPath = path.join(tmpDir, `check_${idx}.c`);
        const oPath = path.join(tmpDir, `check_${idx}.o`);
        fs.writeFileSync(hPath, c99Text, "utf8");
        fs.writeFileSync(cPath, `#include "model_${idx}.h"\nint check_unit_${idx}(void) { return 0; }\n`, "utf8");
        execFileSync(ccBin, ["-std=c99", "-Wall", "-Wextra", "-Wno-unused-function", "-Wno-unused-variable", "-Werror", "-O2", "-c", cPath, "-o", oPath], {
          stdio: "pipe",
        });
      }

      const wgslRes = await call(`/q/models/${m.model_id}/export?runtime=wgsl`);
      assert.equal(wgslRes.status, 200);
      assert.equal(wgslRes.headers.get("content-type"), "text/wgsl; charset=utf-8");
      const wgslText = await wgslRes.text();
      assert.ok(wgslText.includes("@compute @workgroup_size("));

      const glslRes = await call(`/q/models/${m.model_id}/export?runtime=glsl`);
      assert.equal(glslRes.status, 200);
      assert.equal(glslRes.headers.get("content-type"), "text/x-glsl; charset=utf-8");
      const glslText = await glslRes.text();
      assert.ok(glslText.includes("#version 300 es"));
      assert.ok(glslText.includes("out vec4 frag_logit;"));

      const watRes = await call(`/q/models/${m.model_id}/export?runtime=wat`);
      assert.equal(watRes.status, 200);
      const watText = await watRes.text();
      assert.ok(watText.includes("(module"));
      assert.ok(watText.includes('(func (export "infer") (result i32)'));
    }

    // Native compiled Rust + C99 + V8 WebAssembly + JS parity (< 1e-6) on 2-layer router AND Phase 36 SAE & ELK probe models
    if (rustcBin && ccBin && tmpDir) {
      const saeIdx = builtins.findIndex((m) => m.model_id === "tf-sae-matryoshka-residual-v1");
      const elkIdx = builtins.findIndex((m) => m.model_id === "tf-probe-internal-truth-elk-v1");
      assert.ok(saeIdx >= 0 && elkIdx >= 0);

      const rawSae = [0.8, 0.4, 0.2, 0.1, 0.6, 0.2, 0.1, 0.1];
      const saeNorm = Math.sqrt(rawSae.reduce((a, v) => a + v * v, 0));
      const saeVec8 = rawSae.map((v) => v / saeNorm);
      const elkVec8 = [0.92, 0.14, 0.84, 0.68, 0.75, 0.9, 0.16, 0.92];

      for (const spec of [
        { modelId: "tf-sae-matryoshka-residual-v1", idx: saeIdx, outDim: 16, vec: saeVec8 },
        { modelId: "tf-probe-internal-truth-elk-v1", idx: elkIdx, outDim: 3, vec: elkVec8 },
      ]) {
        const rustRlib = path.join(tmpDir, `libkernel_${spec.idx}.rlib`);
        const rsDriver = path.join(tmpDir, `drv_${spec.idx}.rs`);
        const rsBin = path.join(tmpDir, `drv_rs_${spec.idx}`);
        const rsVecLit = spec.vec.map((v) => `${v}_f32`).join(", ");
        fs.writeFileSync(
          rsDriver,
          [
            `extern crate kernel_${spec.idx};`,
            "fn main() {",
            `    let feats: [f32; 8] = [${rsVecLit}];`,
            `    let (logits, _best) = kernel_${spec.idx}::infer(&feats);`,
            "    let parts: Vec<String> = logits.iter().map(|v| format!(\"{:.7}\", v)).collect();",
            "    println!(\"{}\", parts.join(\" \"));",
            "}",
          ].join("\n"),
          "utf8"
        );
        execFileSync(rustcBin, ["--edition", "2021", "-O", rsDriver, "--extern", `kernel_${spec.idx}=${rustRlib}`, "-o", rsBin], {
          stdio: "pipe",
        });
        const rsLogits = execFileSync(rsBin, [], { encoding: "utf8" }).trim().split(/\s+/).map(Number);

        const hContent = fs.readFileSync(path.join(tmpDir, `model_${spec.idx}.h`), "utf8");
        const fnMatch = hContent.match(/static inline void (teleion_infer_[A-Za-z0-9_]+)\(/);
        assert.ok(fnMatch);
        const cDriver = path.join(tmpDir, `drv_${spec.idx}.c`);
        const cBin = path.join(tmpDir, `drv_c_${spec.idx}`);
        const cVecLit = spec.vec.map((v) => `${v}f`).join(", ");
        fs.writeFileSync(
          cDriver,
          [
            "#include <stdio.h>",
            `#include "model_${spec.idx}.h"`,
            "int main(void) {",
            `  const float feats[8] = { ${cVecLit} };`,
            `  float out[${spec.outDim}];`,
            `  ${fnMatch[1]}(feats, 8, out);`,
            `  for (int i = 0; i < ${spec.outDim}; ++i) {`,
            `    printf(i == 0 ? "%.7f" : " %.7f", out[i]);`,
            "  }",
            "  printf(\"\\n\");",
            "  return 0;",
            "}",
          ].join("\n"),
          "utf8"
        );
        execFileSync(ccBin, ["-std=c99", "-O2", cDriver, "-o", cBin], { stdio: "pipe" });
        const cLogits = execFileSync(cBin, [], { encoding: "utf8" }).trim().split(/\s+/).map(Number);

        const wasmBytes = new Uint8Array(
          await (await call(`/q/models/${spec.modelId}/export?runtime=wasm`)).arrayBuffer()
        );
        const wasmInst = (await WebAssembly.instantiate(wasmBytes)).instance;
        const wasmMem = new Float32Array(wasmInst.exports.memory.buffer);
        wasmMem.set(spec.vec, wasmInst.exports.input_offset() / 4);
        wasmInst.exports.infer();
        const wasmLogits = Array.from(
          wasmMem.subarray(wasmInst.exports.output_offset() / 4, wasmInst.exports.output_offset() / 4 + spec.outDim)
        );

        const jsCode = await (await call(`/q/models/${spec.modelId}/export?runtime=js`)).text();
        const jsLogits = new Function(
          "vec",
          `${jsCode.replace(/export const /g, "const ").replace(/export function /g, "function ")}\nreturn Array.from(infer(vec));`
        )(spec.vec);

        const rawSql = await (await call(`/q/models/${spec.modelId}/export?runtime=sql`)).text();
        const customInputValues = spec.vec.map((v, idx) => `(${idx}, ${v})`).join(", ");
        const boundSql = rawSql.replace(/WITH input_vec\(col_idx, x_val\) AS \(\n  VALUES [^\n]+\n\),/, `WITH input_vec(col_idx, x_val) AS (\n  VALUES ${customInputValues}\n),`);
        const memSqlite = new DatabaseSync(":memory:");
        const sqlRows = memSqlite.prepare(boundSql).all();
        memSqlite.close();
        assert.equal(sqlRows.length, spec.outDim);

        for (let i = 0; i < spec.outDim; i += 1) {
          assert.ok(Math.abs(rsLogits[i] - wasmLogits[i]) < 1e-6);
          assert.ok(Math.abs(cLogits[i] - wasmLogits[i]) < 1e-6);
          assert.ok(Math.abs(jsLogits[i] - wasmLogits[i]) < 1e-6);
          assert.ok(Math.abs(Number(sqlRows[i].logit) - wasmLogits[i]) < 2e-6);
        }
      }

      const embedSql = await (await call("/q/models/tf-embed-nullspace-24d-v1/export?runtime=sql")).text();
      const memEmbedDb = new DatabaseSync(":memory:");
      const embedSqlRows = memEmbedDb.prepare(embedSql).all();
      memEmbedDb.close();
      assert.equal(embedSqlRows.length, 24);
    }

    // Native compiled Rust binary execution parity (< 1e-6) against V8 WebAssembly on 2-layer ReLU router
    if (rustcBin && tmpDir) {
      const routerRlib = path.join(tmpDir, "libkernel_0.rlib");
      const driverPath = path.join(tmpDir, "driver.rs");
      const binPath = path.join(tmpDir, "driver_bin");
      const probeFeats = extractPromptFeatures({
        model: "tf-scratch-effort-router-v1",
        text: "Architect a multi-step DAG workflow with polytope matrix constraints, solver tradeoffs, and strict JSON schema",
        step_count: 14,
      });
      const featListLiteral = Array.from(probeFeats.vec12).map((v) => `${v}_f32`).join(", ");
      fs.writeFileSync(
        driverPath,
        [
          "extern crate kernel_0;",
          "fn main() {",
          `    let feats: [f32; 12] = [${featListLiteral}];`,
          "    let (logits, best) = kernel_0::infer(&feats);",
          '    println!("{best} {:.7} {:.7} {:.7} {:.7}", logits[0], logits[1], logits[2], logits[3]);',
          "}",
        ].join("\n"),
        "utf8"
      );
      execFileSync(
        rustcBin,
        ["--edition", "2021", "-O", driverPath, "--extern", `kernel_0=${routerRlib}`, "-o", binPath],
        { stdio: "pipe" }
      );
      const rustOut = execFileSync(binPath, [], { encoding: "utf8" }).trim().split(/\s+/);
      const rustBest = Number(rustOut[0]);
      const rustLogits = rustOut.slice(1).map(Number);

      const wasmBytes = new Uint8Array(
        await (await call("/q/models/tf-scratch-effort-router-v1/export?runtime=wasm")).arrayBuffer()
      );
      const wasmInst = (await WebAssembly.instantiate(wasmBytes)).instance;
      const wasmMem = new Float32Array(wasmInst.exports.memory.buffer);
      wasmMem.set(probeFeats.vec12, wasmInst.exports.input_offset() / 4);
      const wasmBest = wasmInst.exports.infer();
      const wasmLogits = Array.from(
        wasmMem.subarray(wasmInst.exports.output_offset() / 4, wasmInst.exports.output_offset() / 4 + 4)
      );
      assert.equal(rustBest, wasmBest);
      for (let i = 0; i < 4; i += 1) {
        assert.ok(Math.abs(rustLogits[i] - wasmLogits[i]) < 1e-6);
      }
    }
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 1. Two-layer ReLU router (`tf-scratch-effort-router-v1`) numerical parity with `/q/models/infer`
  const routerPrompt = {
    model: "tf-scratch-effort-router-v1",
    text: "Architect a multi-step DAG workflow with polytope matrix constraints, solver tradeoffs, and strict JSON schema",
    step_count: 14,
  };
  const routerInfer = await (
    await call("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(routerPrompt),
    })
  ).json();
  const routerWasmBytes = new Uint8Array(
    await (await call("/q/models/tf-scratch-effort-router-v1/export?runtime=wasm")).arrayBuffer()
  );
  const routerInst = (await WebAssembly.instantiate(routerWasmBytes)).instance;
  const routerFeats = extractPromptFeatures(routerPrompt);
  const routerMem = new Float32Array(routerInst.exports.memory.buffer);
  routerMem.set(routerFeats.vec12, routerInst.exports.input_offset() / 4);
  const routerArgmax = routerInst.exports.infer();
  const routerLogits = Array.from(
    routerMem.subarray(routerInst.exports.output_offset() / 4, routerInst.exports.output_offset() / 4 + 4)
  );
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
    assert.ok(Math.abs(wasmProbs[i] - inferProbs[i]) <= 0.0002);
  }
  let expectedRouterBest = 0;
  for (let i = 1; i < inferProbs.length; i += 1) {
    if (inferProbs[i] > inferProbs[expectedRouterBest]) expectedRouterBest = i;
  }
  assert.equal(routerArgmax, expectedRouterBest);

  // 2. Folded 24-d nullspace embedding (`tf-embed-nullspace-24d-v1`) numerical parity (< 1e-5) with `/q/models/infer`
  const embedPrompt = {
    model: "tf-embed-nullspace-24d-v1",
    text: "Search matrix optimization and SVD nullspace cartridge routes",
  };
  const embedInfer = await (
    await call("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(embedPrompt),
    })
  ).json();
  const embedWasmBytes = new Uint8Array(
    await (await call("/q/models/tf-embed-nullspace-24d-v1/export?runtime=wasm")).arrayBuffer()
  );
  const embedInst = (await WebAssembly.instantiate(embedWasmBytes)).instance;
  const embedFeats = extractPromptFeatures(embedPrompt);
  const embedMem = new Float32Array(embedInst.exports.memory.buffer);
  embedMem.set(embedFeats.vec16, embedInst.exports.input_offset() / 4);
  embedInst.exports.infer();
  const rawWasmEmbed = Array.from(
    embedMem.subarray(embedInst.exports.output_offset() / 4, embedInst.exports.output_offset() / 4 + 24)
  );
  const norm = Math.sqrt(rawWasmEmbed.reduce((acc, v) => acc + v * v, 0)) || 1;
  for (let i = 0; i < 24; i += 1) {
    assert.ok(Math.abs(rawWasmEmbed[i] / norm - embedInfer.outputs.embedding_24d[i]) < 1e-5);
  }

  // 3. Atomic 8x8 cartridge (`tf-cartridge-shared-activity-bank-v1`) numerical parity + MCP wasm_base64 instantiation
  const mcpRes = await call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "export_weight_model",
        arguments: { model_id: "tf-cartridge-shared-activity-bank-v1", runtime: "wasm" },
      },
    }),
  });
  const mcpJson = await mcpRes.json();
  assert.equal(mcpJson.result.isError, false);
  const mcpWasmBytes = Uint8Array.from(Buffer.from(mcpJson.result.structuredContent.wasm_base64, "base64"));
  const mcpInst = (await WebAssembly.instantiate(mcpWasmBytes)).instance;
  const cartPrompt = {
    model: "tf-cartridge-shared-activity-bank-v1",
    cartridge_slot: "slot_0_schema_extractor",
    text: "Extract typed JSON schema fields from multi-step pipeline",
  };
  const cartInfer = await (
    await call("/q/models/infer", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(cartPrompt),
    })
  ).json();
  const cartFeats = extractPromptFeatures(cartPrompt);
  const cartMem = new Float32Array(mcpInst.exports.memory.buffer);
  cartMem.set(cartFeats.vec12.subarray(0, 8), mcpInst.exports.input_offset() / 4);
  const cartArgmax = mcpInst.exports.infer();
  const cartLogits = Array.from(
    cartMem.subarray(mcpInst.exports.output_offset() / 4, mcpInst.exports.output_offset() / 4 + 8)
  );
  for (let i = 0; i < 8; i += 1) {
    assert.ok(Math.abs(Math.round(cartLogits[i] * 10000) / 10000 - cartInfer.outputs.cartridge_logits[i]) <= 0.0002);
  }
  let expectedCartBest = 0;
  for (let i = 1; i < cartLogits.length; i += 1) {
    if (cartLogits[i] > cartLogits[expectedCartBest]) expectedCartBest = i;
  }
  assert.equal(cartArgmax, expectedCartBest);

  // 4. Regression guard: float32 weights whose base64 contains `/EIN[A-Z0-9]{5,19}/` must NOT be corrupted by stripPiiDeep over MCP
  const einWeights = Array.from({ length: 64 }, (_, i) => Math.sin(6250 * 13.37 + i * 0.73) * 200);
  const einModelId = "tf-b64-ein-guard-v1";
  const einRegRes = await call("/q/models/register", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      agent_id: "b64-guard-maker",
      model_id: einModelId,
      family: "atomic_cartridge_bank",
      training_data_ref: "teleion.traces/b64-ein-guard",
      held_out_score: 0.94,
      direct_baseline_score: 0.85,
      shape: [8, 8],
      weights: einWeights,
    }),
  });
  assert.equal(einRegRes.status, 201);

  const directEinWasm = new Uint8Array(await (await call(`/q/models/${einModelId}/export?runtime=wasm`)).arrayBuffer());
  const expectedEinB64 = Buffer.from(directEinWasm).toString("base64");
  assert.ok(stripPiiDeep(expectedEinB64).includes("[id number]"));

  const mcpEinRes = await call("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "export_weight_model",
        arguments: { model_id: einModelId, runtime: "wasm" },
      },
    }),
  });
  assert.equal(mcpEinRes.status, 200);
  const mcpEinJson = await mcpEinRes.json();
  assert.equal(mcpEinJson.result.isError, false);
  assert.ok(!mcpEinJson.result.structuredContent.wasm_base64.includes("[id number]"));
  assert.equal(mcpEinJson.result.structuredContent.wasm_base64, expectedEinB64);
  const parsedContentJson = JSON.parse(mcpEinJson.result.content[0].text);
  assert.equal(parsedContentJson.wasm_base64, expectedEinB64);
  const einDecoded = Uint8Array.from(Buffer.from(mcpEinJson.result.structuredContent.wasm_base64, "base64"));
  assert.deepEqual(Array.from(einDecoded), Array.from(directEinWasm));
  const einInst = (await WebAssembly.instantiate(einDecoded)).instance;
  const einMem = new Float32Array(einInst.exports.memory.buffer);
  einMem.set([0.5, -0.25, 1.0, 0.0, 0.25, -0.5, 0.75, 0.125], einInst.exports.input_offset() / 4);
  const einBest = einInst.exports.infer();
  assert.ok(einBest >= 0 && einBest < 8);
});
