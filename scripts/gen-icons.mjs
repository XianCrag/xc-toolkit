/**
 * Fetch XianCrag GitHub org avatar and write PWA PNG icons.
 * Uses Windows System.Drawing when available; otherwise writes the source
 * PNG for all sizes (browsers scale).
 *
 *   node scripts/gen-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "icons");
const AVATAR_URL = "https://avatars.githubusercontent.com/u/200904873?s=512&v=4";
const BG = "15,20,25"; // match --bg

fs.mkdirSync(outDir, { recursive: true });

const res = await fetch(AVATAR_URL);
if (!res.ok) throw new Error(`avatar fetch failed: ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
const sourcePath = path.join(outDir, "org-source.png");
fs.writeFileSync(sourcePath, buf);
console.log("fetched", AVATAR_URL, `(${buf.length} bytes)`);

const targets = [
  { file: "icon-192.png", size: 192, pad: 0.06 },
  { file: "icon-512.png", size: 512, pad: 0.06 },
  { file: "icon-maskable-512.png", size: 512, pad: 0.18 },
];

const ps = `
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path '${sourcePath.replace(/'/g, "''")}').Path)
$bg = [System.Drawing.Color]::FromArgb(255, ${BG})
function Save-Icon([int]$size, [string]$path, [double]$padRatio) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear($bg)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $pad = [int]($size * $padRatio)
  $inner = $size - 2 * $pad
  $g.DrawImage($src, $pad, $pad, $inner, $inner)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $path"
}
${targets
  .map(
    (t) =>
      `Save-Icon ${t.size} '${path.join(outDir, t.file).replace(/'/g, "''")}' ${t.pad}`,
  )
  .join("\n")}
$src.Dispose()
`;

const result = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-Command", ps],
  { encoding: "utf8" },
);

if (result.status === 0) {
  console.log(result.stdout.trim());
} else {
  console.warn("System.Drawing resize unavailable; copying source PNG for all sizes");
  if (result.stderr) console.warn(result.stderr.trim());
  for (const t of targets) {
    const dest = path.join(outDir, t.file);
    fs.copyFileSync(sourcePath, dest);
    console.log("wrote", dest, "(unpadded copy)");
  }
}

// Favicon SVG embeds the 512 icon so tabs stay sharp without a separate asset pipeline.
const icon512 = fs.readFileSync(path.join(outDir, "icon-512.png"));
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" role="img" aria-label="XianCrag">
  <image width="512" height="512" href="data:image/png;base64,${icon512.toString("base64")}"/>
</svg>
`;
const svgPath = path.join(outDir, "icon.svg");
fs.writeFileSync(svgPath, svg);
console.log("wrote", svgPath);
