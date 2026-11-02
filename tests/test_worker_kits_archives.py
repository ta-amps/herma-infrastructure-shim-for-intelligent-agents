"""End-to-end Python zipfile / tarfile & CLI archive verification for Herma v6.11 worker kits."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import subprocess
import tarfile
import tempfile
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = REPO_ROOT / "deploy" / "cloudflare" / "worker_kits_and_mutation_grid.js"


def test_worker_kits_tgz_and_pkzip_pass_python_stdlib_and_system_extractors() -> None:
    node_script = (
        f"import({json.dumps(MODULE_PATH.as_uri())}).then(async (m) => {{\n"
        "  const b = await m.buildWorkerKitArtifacts('https://herma.ta-amps.workers.dev');\n"
        "  const tgz = b.filesByRoute['herma-agent-kit.tgz'];\n"
        "  const zip = b.filesByRoute['herma-worker-kit.zip'];\n"
        "  console.log(JSON.stringify({\n"
        "    tgz_sha256: tgz.sha256,\n"
        "    tgz_b64: Buffer.from(tgz.bytes).toString('base64'),\n"
        "    zip_sha256: zip.sha256,\n"
        "    zip_b64: Buffer.from(zip.bytes).toString('base64'),\n"
        "  }));\n"
        "});"
    )
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", node_script],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(proc.stdout.strip())
    tgz_bytes = base64.b64decode(payload["tgz_b64"])
    zip_bytes = base64.b64decode(payload["zip_b64"])

    assert hashlib.sha256(tgz_bytes).hexdigest() == payload["tgz_sha256"]
    assert hashlib.sha256(zip_bytes).hexdigest() == payload["zip_sha256"]

    with tarfile.open(fileobj=io.BytesIO(tgz_bytes), mode="r:gz") as tf:
        names = tf.getnames()
        assert "package/package.json" in names
        assert "package/bin/herma-kit.mjs" in names
        assert "package/index.mjs" in names
        assert "package/README.md" in names
        pkg_member = tf.extractfile("package/package.json")
        assert pkg_member is not None
        pkg_doc = json.loads(pkg_member.read().decode("utf-8"))
        assert pkg_doc["name"] == "herma-agent-kit"

    with zipfile.ZipFile(io.BytesIO(zip_bytes), mode="r") as zf:
        assert zf.testzip() is None
        znames = zf.namelist()
        assert "herma_shim.py" in znames
        assert "worker_distributed_indexer.py" in znames
        assert "herma_cli.mjs" in znames
        assert "SKILL.md" in znames
        assert "hooks/pretool_guard.py" in znames
        assert "hooks/claude_settings_example.json" in znames
        assert "bootstrap.sh" in znames

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        tgz_file = tmp / "herma-agent-kit.tgz"
        zip_file = tmp / "herma-worker-kit.zip"
        tgz_file.write_bytes(tgz_bytes)
        zip_file.write_bytes(zip_bytes)

        tar_list = subprocess.run(
            ["tar", "-tzf", str(tgz_file)],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "package/bin/herma-kit.mjs" in tar_list.stdout

        unzip_test = subprocess.run(
            ["unzip", "-t", str(zip_file)],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "No errors detected" in unzip_test.stdout
