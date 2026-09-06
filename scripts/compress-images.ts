#!/usr/bin/env bun
/**
 * Smart AVIF compression using Bun's built-in Image API.
 *
 * Rule of thumb (tuned against this repo's avatar images):
 *   - Images already at or below MAX_DIM on their longest side are left at
 *     native resolution and encoded at a higher quality, since there's no
 *     downscale to hide re-encoding artifacts behind.
 *   - Images larger than MAX_DIM get downscaled to fit inside MAX_DIM and
 *     encoded at a lower quality, since the downscale itself removes detail
 *     and hides more aggressive compression.
 *
 * Usage:
 *   bun scripts/compress-images.ts <file-or-dir> [...more files-or-dirs]
 *   bun scripts/compress-images.ts src/assets/avatars --replace
 *   bun scripts/compress-images.ts photo.png --max-dim 1000 --quality-small 70 --quality-large 40
 *
 * Flags:
 *   --replace          delete the source file once the .avif is written
 *   --max-dim <n>       longest-side threshold in px (default 1200)
 *   --quality-small <n> avif quality for images at/under max-dim (default 65)
 *   --quality-large <n> avif quality for downscaled images (default 45)
 *   --dry-run           print what would happen without writing anything
 */

import { readdir } from "node:fs/promises";
import { extname, join, dirname, basename } from "node:path";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".heic"]);

interface Options {
  maxDim: number;
  qualitySmall: number;
  qualityLarge: number;
  replace: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): { targets: string[]; options: Options } {
  const targets: string[] = [];
  const options: Options = {
    maxDim: 1200,
    qualitySmall: 65,
    qualityLarge: 45,
    replace: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--replace":
        options.replace = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--max-dim":
        options.maxDim = Number(argv[++i]);
        break;
      case "--quality-small":
        options.qualitySmall = Number(argv[++i]);
        break;
      case "--quality-large":
        options.qualityLarge = Number(argv[++i]);
        break;
      default:
        targets.push(arg);
    }
  }

  return { targets, options };
}

async function collectImageFiles(target: string): Promise<string[]> {
  const stat = await Bun.file(target).stat().catch(() => null);
  if (!stat) {
    console.error(`skip: not found: ${target}`);
    return [];
  }

  if (stat.isFile()) {
    return IMAGE_EXTENSIONS.has(extname(target).toLowerCase()) ? [target] : [];
  }

  const entries = await readdir(target, { withFileTypes: true, recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    files.push(join(entry.parentPath ?? target, entry.name));
  }
  return files;
}

function pipelineFor(path: string, willDownscale: boolean, options: Options) {
  let pipeline = Bun.file(path).image();
  if (willDownscale) {
    pipeline = pipeline.resize(options.maxDim, options.maxDim, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  return pipeline;
}

async function compressOne(path: string, options: Options): Promise<void> {
  const img = Bun.file(path).image();
  const { width, height } = await img.metadata();
  const longestSide = Math.max(width, height);

  const willDownscale = longestSide > options.maxDim;
  const quality = willDownscale ? options.qualityLarge : options.qualitySmall;
  const before = (await Bun.file(path).stat()).size;

  if (options.dryRun) {
    const outPath = join(dirname(path), `${basename(path, extname(path))}.avif`);
    console.log(
      `[dry-run] ${path} (${width}x${height}, ${(before / 1024).toFixed(0)}kB) -> ${outPath}` +
        ` [${willDownscale ? `downscale to ${options.maxDim}px, ` : "native res, "}quality ${quality}]`,
    );
    return;
  }

  // AVIF encoding depends on the OS having a system AV1 codec installed.
  // Fall back to WebP (near-universal system codec support) when it isn't.
  let format = "avif";
  let outPath = join(dirname(path), `${basename(path, extname(path))}.avif`);
  let bytesWritten: number;
  try {
    bytesWritten = await pipelineFor(path, willDownscale, options)
      .avif({ quality })
      .write(outPath);
  } catch (err) {
    if ((err as { code?: string }).code !== "ERR_IMAGE_ENCODE_FAILED") throw err;
    format = "webp";
    outPath = join(dirname(path), `${basename(path, extname(path))}.webp`);
    bytesWritten = await pipelineFor(path, willDownscale, options)
      .webp({ quality })
      .write(outPath);
    console.warn(`  (AVIF encoder unavailable on this system, wrote WebP instead)`);
  }

  if (options.replace && outPath !== path) {
    await Bun.file(path).delete();
  }

  console.log(
    `${path} (${(before / 1024).toFixed(0)}kB) -> ${outPath} (${(bytesWritten / 1024).toFixed(0)}kB)` +
      ` [${willDownscale ? `downscaled to fit ${options.maxDim}px` : "native res"}, ${format} quality ${quality}]`,
  );
}

async function main() {
  const { targets, options } = parseArgs(Bun.argv.slice(2));

  if (targets.length === 0) {
    console.error(
      "usage: bun scripts/compress-images.ts <file-or-dir> [...] [--replace] [--dry-run] [--max-dim n] [--quality-small n] [--quality-large n]",
    );
    process.exit(1);
  }

  const files = (await Promise.all(targets.map(collectImageFiles))).flat();
  if (files.length === 0) {
    console.error("no matching images found");
    process.exit(1);
  }

  for (const file of files) {
    try {
      await compressOne(file, options);
    } catch (err) {
      console.error(`failed: ${file}: ${(err as Error).message}`);
    }
  }
}

await main();
