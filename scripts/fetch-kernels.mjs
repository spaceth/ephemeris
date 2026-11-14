/**
 * Download the NAIF files named in kernels/sources.json.
 * A file already on disk is kept when its SHA-256 matches.
 * A mismatch is a failure. The script does not overwrite a wrong file.
 *
 *   node scripts/fetch-kernels.mjs
 */

import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const index = JSON.parse(readFileSync(new URL("../kernels/sources.json", import.meta.url), "utf8"));

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const entry of index.files) {
  if (existsSync(entry.path) && sha256(entry.path) === entry.sha256) {
    console.log(`ok ${entry.path}`);
    continue;
  }
  if (existsSync(entry.path)) {
    throw new Error(`${entry.path} is present and its SHA-256 does not match kernels/sources.json`);
  }
  console.log(`fetch ${entry.url}`);
  const response = await fetch(entry.url);
  if (!response.ok || !response.body) throw new Error(`${entry.url} returned ${response.status}`);
  mkdirSync(dirname(entry.path), { recursive: true });
  const temporary = `${entry.path}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  const got = sha256(temporary);
  if (got !== entry.sha256) {
    rmSync(temporary, { force: true });
    throw new Error(`${entry.filename} SHA-256 ${got} does not match ${entry.sha256}`);
  }
  renameSync(temporary, entry.path);
  console.log(`wrote ${entry.path}`);
}
