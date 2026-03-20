/**
 * Generates 3D-looking glass lens images from LENS_TYPES tint data.
 * Returns an array of data URL strings (one per lens type).
 */
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function hexToRgb(n) {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function generateLensImage(tint) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  const [cr, cg, cb] = hexToRgb(tint.color);
  const baseAlpha = 0.4 + (1 - tint.transmission) * 0.6;

  // 1) Dark background fill (so the lens pops)
  ctx.fillStyle = "#0a0a0a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 2) Base lens color — radial gradient (lighter center, darker rim)
  const baseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  baseGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${baseAlpha})`);
  baseGrad.addColorStop(0.6, `rgba(${cr}, ${cg}, ${cb}, ${baseAlpha * 0.85})`);
  baseGrad.addColorStop(1, `rgba(${Math.max(0, cr - 40)}, ${Math.max(0, cg - 40)}, ${Math.max(0, cb - 40)}, ${Math.min(1, baseAlpha * 1.3)})`);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();

  // 3) Inner glow / refraction ring
  const glowGrad = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 0.85);
  glowGrad.addColorStop(0, `rgba(${Math.min(255, cr + 60)}, ${Math.min(255, cg + 60)}, ${Math.min(255, cb + 60)}, 0.08)`);
  glowGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // 4) Specular highlight (upper-left offset for 3D depth)
  const specX = cx - r * 0.25;
  const specY = cy - r * 0.3;
  const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, r * 0.6);
  specGrad.addColorStop(0, "rgba(255, 255, 255, 0.35)");
  specGrad.addColorStop(0.3, "rgba(255, 255, 255, 0.12)");
  specGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = specGrad;
  ctx.fill();

  // 5) Rim shadow for depth (dark edge ring)
  const rimGrad = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r);
  rimGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
  rimGrad.addColorStop(0.7, "rgba(0, 0, 0, 0.15)");
  rimGrad.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = rimGrad;
  ctx.fill();

  // 6) Subtle rim highlight (thin bright edge on upper-left)
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // 7) Secondary smaller specular (lower-right, subtle)
  const spec2X = cx + r * 0.3;
  const spec2Y = cy + r * 0.25;
  const spec2Grad = ctx.createRadialGradient(spec2X, spec2Y, 0, spec2X, spec2Y, r * 0.2);
  spec2Grad.addColorStop(0, "rgba(255, 255, 255, 0.1)");
  spec2Grad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = spec2Grad;
  ctx.fill();

  return canvas.toDataURL("image/png");
}

export function generateLensImages(lensTypes) {
  return lensTypes.map((lt) => generateLensImage(lt.tint));
}
