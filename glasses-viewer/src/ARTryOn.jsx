import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

/* ═══════════════════════════════════════════════════════════
   1. ONE EURO FILTER & MATH
   ═══════════════════════════════════════════════════════════ */
class LowPassFilter {
  constructor(alpha) {
    this.y = null;
    this.s = null;
    this.setAlpha(alpha);
  }
  setAlpha(alpha) {
    this.alpha = Math.max(0.0001, Math.min(1, alpha));
  }
  filter(value) {
    if (this.y === null) {
      this.s = value;
    } else {
      this.s = this.alpha * value + (1 - this.alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }
  lastValue() { return this.y; }
  reset() { this.y = null; this.s = null; }
}

class OneEuroFilter {
  constructor(freq = 30, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPassFilter(this._alpha(minCutoff));
    this.dx = new LowPassFilter(this._alpha(dCutoff));
    this.lastTime = null;
  }

  _alpha(cutoff) {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  filter(value, timestamp) {
    if (this.lastTime !== null && timestamp !== this.lastTime) {
      this.freq = 1.0 / ((timestamp - this.lastTime) / 1000);
    }
    this.lastTime = timestamp;

    const prev = this.x.lastValue();
    const dx = prev === null ? 0 : (value - prev) * this.freq;

    const edx = this.dx.filter(dx);
    this.dx.setAlpha(this._alpha(this.dCutoff));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.x.setAlpha(this._alpha(cutoff));

    return this.x.filter(value);
  }

  reset() {
    this.x.reset();
    this.dx.reset();
    this.lastTime = null;
  }
}

class FilterBank {
  constructor(config) {
    this.filters = {};
    this.config = config;
  }

  filter(key, value, timestamp) {
    if (!this.filters[key]) {
      const c = this.config[key] || this.config._default;
      this.filters[key] = new OneEuroFilter(c.freq, c.minCutoff, c.beta, c.dCutoff);
    }
    return this.filters[key].filter(value, timestamp);
  }

  reset() {
    Object.values(this.filters).forEach(f => f.reset());
  }
}

const FILTER_CONFIG = {
  px:    { freq: 30, minCutoff: 1.5,  beta: 0.5,  dCutoff: 1.0 },
  py:    { freq: 30, minCutoff: 1.5,  beta: 0.5,  dCutoff: 1.0 },
  scale: { freq: 30, minCutoff: 0.3,  beta: 0.01, dCutoff: 1.0 },
  roll:  { freq: 30, minCutoff: 1.2,  beta: 0.4,  dCutoff: 1.0 },
  yaw:   { freq: 30, minCutoff: 1.0,  beta: 0.3,  dCutoff: 1.0 },
  pitch: { freq: 30, minCutoff: 0.8,  beta: 0.2,  dCutoff: 1.0 },
  depth: { freq: 30, minCutoff: 0.2,  beta: 0.01, dCutoff: 1.0 },
  _default: { freq: 30, minCutoff: 1.0, beta: 0.1, dCutoff: 1.0 },
};

/* ═══════════════════════════════════════════════════════════
   2. POSE ESTIMATION
   ═══════════════════════════════════════════════════════════ */
const LM = {
  leftEyeOuter: 33, rightEyeOuter: 263,
  leftEyeInner: 133, rightEyeInner: 362,
  leftTemple: 234, rightTemple: 454,
  noseBridge: 6, noseBridgeTop: 168, noseTip: 1,
  foreHead: 10, chin: 152,
  leftCheek: 234, rightCheek: 454,
  leftBrowOuter: 46, rightBrowOuter: 276,
  leftIris: [468, 469, 470, 471, 472],
  rightIris: [473, 474, 475, 476, 477],
};

function dist3D(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2);
}

function avgLandmark(...lms) {
  const n = lms.length;
  return {
    x: lms.reduce((s, l) => s + l.x, 0) / n,
    y: lms.reduce((s, l) => s + l.y, 0) / n,
    z: lms.reduce((s, l) => s + (l.z || 0), 0) / n,
  };
}

function extractFacePose(landmarks, vWidth, vHeight, facialMatrix, calibratedFaceWidth = null) {
  const bridge = landmarks[LM.noseBridge];
  const bridgeTop = landmarks[LM.noseBridgeTop];
  const leftEyeO = landmarks[LM.leftEyeOuter];
  const rightEyeO = landmarks[LM.rightEyeOuter];
  const leftEyeI = landmarks[LM.leftEyeInner];
  const rightEyeI = landmarks[LM.rightEyeInner];
  const leftTemple = landmarks[LM.leftTemple];
  const rightTemple = landmarks[LM.rightTemple];

  const eyeOuterW = dist3D(leftEyeO, rightEyeO);
  
  /* Iris-based scaling for pinpoint accuracy */
  const lIris = landmarks[LM.leftIris[0]];
  const rIris = landmarks[LM.rightIris[0]];
  const lIrisH = dist3D(landmarks[LM.leftIris[1]], landmarks[LM.leftIris[2]]);
  const rIrisH = dist3D(landmarks[LM.rightIris[1]], landmarks[LM.rightIris[2]]);
  const avgIrisH = (lIrisH + rIrisH) / 2;

  const modelWidth = 1.92;
  let scale;

  if (avgIrisH > 0.005) {
    /* The core 'Pinpoint' logic: 
       Translate the physical frame width (based on size selection) 
       into 3D space using the Iris (11.7mm) as the constant ruler.
    */
    const mmPerUnit = 11.7 / avgIrisH;
    /* We want the model to be sized correctly for the user's calibrated width */
    /* If the model was designed for a 140mm face, but the user is 130mm, we scale it */
    scale = (mmPerUnit * 13.5) / modelWidth; // 13.5 is a heuristic for model units to mm
  } else if (calibratedFaceWidth) {
    scale = (calibratedFaceWidth * (eyeOuterW / 0.085)) / modelWidth * 1.2;
  } else {
    const templeW = dist3D(leftTemple, rightTemple);
    const faceW = (templeW * 0.4 + eyeOuterW * 0.6) * vWidth;
    scale = (faceW / modelWidth) * 1.6;
  }

  let roll = 0, yaw = 0, pitch = 0;

  if (facialMatrix && facialMatrix.data) {
    const d = facialMatrix.data;
    const R00 = d[0], R01 = d[4], R02 = d[8];
    const R10 = d[1], R11 = d[5], R12 = d[9];
    const R20 = d[2], R21 = d[6], R22 = d[10];

    const sy = Math.sqrt(R00 * R00 + R10 * R10);
    const singular = sy < 1e-6;

    if (!singular) {
      pitch = Math.atan2(R21, R22);
      yaw   = Math.atan2(-R20, sy);
      roll  = Math.atan2(R10, R00);
    } else {
      pitch = Math.atan2(-R12, R11);
      yaw   = Math.atan2(-R20, sy);
      roll  = 0;
    }

    yaw = -yaw;
    roll = -roll;
    pitch = Math.max(-1.2, Math.min(1.2, pitch));
    yaw   = Math.max(-1.2, Math.min(1.2, yaw));
    roll  = Math.max(-0.8, Math.min(0.8, roll));
  } else {
    roll = -Math.atan2(rightEyeO.y - leftEyeO.y, rightEyeO.x - leftEyeO.x);
    const leftDist = Math.abs(bridge.x - leftTemple.x);
    const rightDist = Math.abs(bridge.x - rightTemple.x);
    const totalDist = leftDist + rightDist;
    const yawNorm = totalDist > 0.001 ? ((leftDist / totalDist) - 0.5) * 2.0 : 0;
    yaw = Math.asin(Math.max(-0.95, Math.min(0.95, yawNorm * 0.9)));
    pitch = 0;
  }

  const innerMid = avgLandmark(leftEyeI, rightEyeI);
  const anchor = avgLandmark(bridge, bridgeTop, innerMid);

  const pxBase = (0.5 - bridge.x) * vWidth;
  const noseProtrusionScale = faceW * 0.12; 
  const yawCorr = Math.sin(yaw) * noseProtrusionScale;
  const px = pxBase + (yawCorr * vWidth);
  const py = -(anchor.y - 0.5) * vHeight - vHeight * 0.02;

  const depthScale = (0.085 / eyeOuterW) * 0.15;
  const depthFromZ = (anchor.z * 0.2) + (depthScale * -1);

  return { px, py, scale, roll, yaw, pitch, depthOffset: depthFromZ };
}

/* ═══════════════════════════════════════════════════════════
   3. AR GEOMETRY & FRAMES
   ═══════════════════════════════════════════════════════════ */
const MATERIAL_PBR = { metalness: 0.05, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 };
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function makeMaterials(color, matPbr) {
  const p = matPbr || { metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 };
  return {
    frame: new THREE.MeshPhysicalMaterial({ color: color.frame, ...p, side: THREE.DoubleSide }),
    lens: new THREE.MeshPhysicalMaterial({ color: color.lens, metalness: 0, roughness: 0.05, transmission: 0.8, thickness: 0.3, ior: 1.5, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    hinge: new THREE.MeshPhysicalMaterial({ color: color.accent, metalness: 0.9, roughness: 0.12, clearcoat: 0.5, side: THREE.DoubleSide }),
  };
}

function tag(m, n) { m.userData.partName = n; return m; }

function addTemples(g, mat, xs, yS = 0) {
  xs.forEach(({ x, sign }) => {
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x, yS, 0), new THREE.Vector3(x + sign * 0.04, yS, -0.3), new THREE.Vector3(x + sign * 0.04, yS - 0.04, -0.9), new THREE.Vector3(x + sign * 0.02, yS - 0.14, -1.05)]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, 32, 0.02, 8, false), mat); m.castShadow = true; tag(m, x < 0 ? "left-temple" : "right-temple"); g.add(m);
  });
}

function addHinges(g, mat, ps) {
  const geo = new THREE.CylinderGeometry(0.028, 0.028, 0.055, 12);
  ps.forEach(([x, y], i) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, -0.01); m.rotation.z = Math.PI / 2; m.castShadow = true; tag(m, i === 0 ? "left-hinge" : "right-hinge"); g.add(m); });
}

function addNosePads(g, mat, ps) {
  const geo = new THREE.SphereGeometry(0.025, 12, 12);
  ps.forEach(([x, y, z], i) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(1, 1.3, 0.6); tag(m, i === 0 ? "left-pad" : "right-pad"); g.add(m); });
}

function buildAviator(color, matPbr) {
  const g = new THREE.Group(), m = makeMaterials(color, matPbr);
  const s = new THREE.Shape(); s.moveTo(0, 0.38); s.quadraticCurveTo(0.42, 0.38, 0.44, 0); s.quadraticCurveTo(0.42, -0.42, 0, -0.44); s.quadraticCurveTo(-0.42, -0.42, -0.44, 0); s.quadraticCurveTo(-0.42, 0.38, 0, 0.38);
  const pts = s.getPoints(64), rG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, p.y, 0)), true), 64, 0.03, 8, true), dG = new THREE.ShapeGeometry(s, 64);
  [-0.54, 0.54].forEach((x, i) => { const r = tag(new THREE.Mesh(rG, m.frame), i === 0 ? "left-rim" : "right-rim"); r.position.x = x; r.castShadow = true; g.add(r); const d = tag(new THREE.Mesh(dG, m.lens), i === 0 ? "left-lens" : "right-lens"); d.position.set(x, 0, 0.005); g.add(d); });
  [0.08, -0.02].forEach((y, i) => { const c = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.12, y, 0), new THREE.Vector3(0, y + 0.04, 0.02), new THREE.Vector3(0.12, y, 0)]); g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(c, 16, 0.018, 8, false), m.frame), i === 0 ? "bridge-upper" : "bridge-lower")); });
  addTemples(g, m.frame, [{ x: -0.96, sign: -1 }, { x: 0.96, sign: 1 }]); addHinges(g, m.hinge, [[-0.96, 0], [0.96, 0]]); addNosePads(g, m.hinge, [[-0.16, -0.28, 0.08], [0.16, -0.28, 0.08]]); return g;
}

function buildWayfarer(color, matPbr) {
  const g = new THREE.Group(), m = makeMaterials(color, matPbr); m.frame.metalness = Math.min(m.frame.metalness, 0.1);
  const s = new THREE.Shape(); s.moveTo(-0.38, 0.24); s.lineTo(0.4, 0.28); s.quadraticCurveTo(0.44, 0, 0.38, -0.24); s.lineTo(-0.36, -0.22); s.quadraticCurveTo(-0.42, 0, -0.38, 0.24);
  const pts = s.getPoints(64), rG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, p.y, 0)), true), 64, 0.04, 8, true), dG = new THREE.ShapeGeometry(s, 64);
  const tb = new THREE.Shape(); tb.moveTo(-1.02, 0.22); tb.lineTo(1.02, 0.22); tb.lineTo(1.02, 0.36); tb.quadraticCurveTo(0, 0.40, -1.02, 0.36); tb.lineTo(-1.02, 0.22);
  const t = tag(new THREE.Mesh(new THREE.ExtrudeGeometry(tb, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 3 }), m.frame), "top-bar"); t.position.z = -0.03; t.castShadow = true; g.add(t);
  [-0.52, 0.52].forEach((x, i) => { const r = tag(new THREE.Mesh(rG, m.frame), i === 0 ? "left-rim" : "right-rim"); r.position.x = x; r.castShadow = true; g.add(r); const d = tag(new THREE.Mesh(dG, m.lens), i === 0 ? "left-lens" : "right-lens"); d.position.set(x, 0, 0.005); g.add(d); });
  const bc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.14, 0.04, 0), new THREE.Vector3(0, 0.10, 0.02), new THREE.Vector3(0.14, 0.04, 0)]); g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc, 16, 0.028, 8, false), m.frame), "bridge"));
  addTemples(g, m.frame, [{ x: -0.94, sign: -1 }, { x: 0.94, sign: 1 }]); addHinges(g, m.hinge, [[-0.94, 0.05], [0.94, 0.05]]); addNosePads(g, m.hinge, [[-0.16, -0.18, 0.08], [0.16, -0.18, 0.08]]); return g;
}

function buildRound(color, matPbr) {
  const g = new THREE.Group(), m = makeMaterials(color, matPbr); const rG = new THREE.TorusGeometry(0.38, 0.022, 16, 64), dG = new THREE.CircleGeometry(0.38, 64);
  [-0.48, 0.48].forEach((x, i) => { const r = tag(new THREE.Mesh(rG, m.frame), i === 0 ? "left-rim" : "right-rim"); r.position.x = x; r.castShadow = true; g.add(r); const d = tag(new THREE.Mesh(dG, m.lens), i === 0 ? "left-lens" : "right-lens"); d.position.set(x, 0, 0.005); g.add(d); });
  const bc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.10, 0.06, 0), new THREE.Vector3(-0.04, 0.14, 0.03), new THREE.Vector3(0.04, 0.14, 0.03), new THREE.Vector3(0.10, 0.06, 0)]); g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc, 20, 0.018, 8, false), m.frame), "bridge"));
  addTemples(g, m.frame, [{ x: -0.86, sign: -1 }, { x: 0.86, sign: 1 }]); addHinges(g, m.hinge, [[-0.86, 0], [0.86, 0]]); addNosePads(g, m.hinge, [[-0.14, -0.22, 0.08], [0.14, -0.22, 0.08]]); return g;
}

function buildCatEye(color, matPbr) {
  const g = new THREE.Group(), m = makeMaterials(color, matPbr);
  const s = new THREE.Shape(); s.moveTo(-0.36, 0.18); s.quadraticCurveTo(-0.10, 0.30, 0.20, 0.34); s.quadraticCurveTo(0.46, 0.30, 0.44, 0.08); s.quadraticCurveTo(0.42, -0.22, 0.10, -0.26); s.quadraticCurveTo(-0.24, -0.26, -0.38, -0.10); s.quadraticCurveTo(-0.42, 0.04, -0.36, 0.18);
  const pts = s.getPoints(64), rG = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, p.y, 0)), true), 64, 0.035, 8, true), dG = new THREE.ShapeGeometry(s, 64);
  [-0.52, 0.52].forEach((x, i) => { const r = tag(new THREE.Mesh(rG, m.frame), i === 0 ? "left-rim" : "right-rim"); r.position.x = x; if (i === 0) r.scale.x = -1; r.castShadow = true; g.add(r); const d = tag(new THREE.Mesh(dG, m.lens), i === 0 ? "left-lens" : "right-lens"); d.position.set(x, 0, 0.005); if (i === 0) d.scale.x = -1; g.add(d); });
  const bc = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.14, 0.10, 0), new THREE.Vector3(0, 0.16, 0.02), new THREE.Vector3(0.14, 0.10, 0)]); g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc, 16, 0.025, 8, false), m.frame), "bridge"));
  addTemples(g, m.frame, [{ x: -0.92, sign: -1 }, { x: 0.92, sign: 1 }], 0.12); addHinges(g, m.hinge, [[-0.92, 0.12], [0.92, 0.12]]); addNosePads(g, m.hinge, [[-0.16, -0.16, 0.08], [0.16, -0.16, 0.08]]); return g;
}

const AR_FRAMES = [
  {
    id: "custom", name: "Eza Custom Design", url: "/models/glasses.glb",
    colors: [
      { name: "Original", frame: 0xffffff, lens: 0xffffff, accent: 0xffffff },
    ],
  },
  {
    id: "aviator", name: "Aviator Classic", build: buildAviator,
    colors: [
      { name: "Charcoal", frame: 0x3a3a3a, lens: 0x556b2f, accent: 0x777777 },
      { name: "Sand", frame: 0xc8a84e, lens: 0x5a4a2a, accent: 0xd4af37 },
      { name: "Blush", frame: 0xb76e79, lens: 0x6b4a52, accent: 0xd4a0a0 },
    ],
  },
  {
    id: "wayfarer", name: "Wayfarer Bold", build: buildWayfarer,
    colors: [
      { name: "Matte Black", frame: 0x1a1a1a, lens: 0x333344, accent: 0x444444 },
      { name: "Tortoise", frame: 0x8b5e3c, lens: 0x5a4530, accent: 0xa0724a },
      { name: "Navy", frame: 0x1a2744, lens: 0x334466, accent: 0x3a5580 },
    ],
  },
  {
    id: "round", name: "Round Wire", build: buildRound,
    colors: [
      { name: "Silver", frame: 0xc0c0c0, lens: 0x99bbdd, accent: 0xe0e0e0 },
      { name: "Black", frame: 0x222222, lens: 0x445566, accent: 0x555555 },
      { name: "Copper", frame: 0xb87333, lens: 0x88775a, accent: 0xcc8844 },
    ],
  },
  {
    id: "cat-eye", name: "Cat-Eye Luxe", build: buildCatEye,
    colors: [
      { name: "Burgundy", frame: 0x6b2040, lens: 0x553344, accent: 0x8a3050 },
      { name: "Ivory", frame: 0xd4c8b0, lens: 0x998877, accent: 0xe8dcc0 },
      { name: "Emerald", frame: 0x1a5c3a, lens: 0x2a4a3a, accent: 0x2a7a50 },
    ],
  },
];

/* ═══════════════════════════════════════════════════════════
   4. MAIN REACT COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ARTryOn({ onBack, faceWidth }) {
  const videoRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const threeContainerRef = useRef(null);
  const sceneRef = useRef({});
  const filterBankRef = useRef(new FilterBank(FILTER_CONFIG));
  const faceLandmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const glassesOpacityRef = useRef(0);
  const targetOpacityRef = useRef(0);
  const prevFrameIdxRef = useRef(-1);

  const [status, setStatus] = useState("idle");
  const [frameIdx, setFrameIdx] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const frame = AR_FRAMES[frameIdx];
  const color = frame.colors[colorIdx];

  const gltfLoader = useMemo(() => new GLTFLoader(), []);
  const reqIdRef = useRef(0);

  /* ── inject CSS ── */
  useEffect(() => {
    const id = "ar-tryon-styles";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = `
      @keyframes arPulse { 0%,100% { opacity:0.4 } 50% { opacity:1 } }
      @keyframes arFadeIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
      @keyframes arSlideUp { from { opacity:0; transform:translateY(20px) } to { opacity:1; transform:translateY(0) } }
      .ar-frame-btn { transition: all 0.3s cubic-bezier(0.23,1,0.32,1) !important; }
      .ar-frame-btn:hover { transform: translateY(-2px) !important; background: rgba(255,255,255,0.12) !important; }
      .ar-swatch { transition: all 0.25s !important; }
      .ar-swatch:hover { transform: scale(1.3) !important; }
      .ar-capture-btn { transition: all 0.3s !important; }
      .ar-capture-btn:hover { transform: scale(1.1) !important; box-shadow: 0 0 30px rgba(255,255,255,0.3) !important; }
      .ar-back-btn { transition: all 0.3s !important; }
      .ar-back-btn:hover { background: rgba(255,255,255,0.15) !important; }
    `;
    document.head.appendChild(s);
  }, []);

  /* ── build / rebuild glasses model ── */
  const buildGlasses = useCallback(async (fIdx, cIdx) => {
    const { scene, glasses: old } = sceneRef.current;
    if (!scene) return;

    const f = AR_FRAMES[fIdx];
    const reqId = ++reqIdRef.current;

    let model;
    if (f.url) {
      try {
        const gltf = await new Promise((resolve, reject) => {
          gltfLoader.load(f.url, resolve, undefined, reject);
        });
        if (reqId !== reqIdRef.current) return;
        
        model = gltf.scene;
        model.rotation.y = -Math.PI / 2;
        model.updateMatrixWorld(true);

        let minZ = Infinity, maxZ = -Infinity;
        model.traverse(ch => {
          if (ch.isMesh) {
            ch.geometry.computeBoundingBox();
            const bbox = ch.geometry.boundingBox.clone().applyMatrix4(ch.matrixWorld);
            minZ = Math.min(minZ, bbox.min.z);
            maxZ = Math.max(maxZ, bbox.max.z);
          }
        });

        const depth = maxZ - minZ;
        const frontThreshold = maxZ - (depth * 0.1); 
        const frontBox = new THREE.Box3();
        model.traverse(ch => {
          if (ch.isMesh) {
            const pos = ch.geometry.attributes.position;
            const mat = ch.matrixWorld;
            for (let i = 0; i < pos.count; i++) {
              const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mat);
              if (v.z >= frontThreshold) frontBox.expandByPoint(v);
            }
          }
        });

        const center = frontBox.getCenter(new THREE.Vector3());
        const size = frontBox.getSize(new THREE.Vector3());
        const targetWidth = 1.9;
        const scaleFac = targetWidth / Math.max(size.x, 0.1);

        model.scale.setScalar(scaleFac);
        model.position.set(-center.x * scaleFac, -center.y * scaleFac, -maxZ * scaleFac);

        model.traverse(ch => {
          if (ch.isMesh) {
            const name = ch.name.toLowerCase();
            if (name.includes("temple") || name.includes("arm")) {
              const weight = ch.position.x < 0 ? -1 : 1;
              ch.rotation.y += 0.08 * weight;
            }
          }
        });
      } catch (err) {
        console.error("GLB Load Error:", err);
        return;
      }
    } else {
      const c = f.colors[cIdx];
      model = f.build(c, MATERIAL_PBR);
    }

    if (old) {
      scene.remove(old);
      old.traverse((ch) => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
    }

    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.visible = false;

    pivot.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.userData._baseOpacity = child.material.opacity !== undefined ? child.material.opacity : 1;
        child.castShadow = true;
      }
    });

    scene.add(pivot);
    sceneRef.current.glasses = pivot;
  }, [gltfLoader]);

  /* ── Update colors without rebuilding geometry ── */
  const updateGlassesColor = useCallback((fIdx, cIdx) => {
    const { glasses } = sceneRef.current;
    if (!glasses) return;

    const f = AR_FRAMES[fIdx];
    const color = f.colors[cIdx];
    if (!color) return;

    glasses.traverse((ch) => {
      if (!ch.isMesh || !ch.material) return;
      
      const part = ch.userData.partName || "";
      const materials = Array.isArray(ch.material) ? ch.material : [ch.material];

      materials.forEach(mat => {
        if (!mat.color) return;
        if (part.includes("lens")) {
          mat.color.setHex(color.lens);
        } else if (part.includes("hinge") || part.includes("pad")) {
          mat.color.setHex(color.accent);
        } else if (part) {
          mat.color.setHex(color.frame);
        } else if (f.url) {
          mat.color.setHex(color.frame);
        }
      });
    });
  }, []);

  /* ── Effect to smartly route rebuilds vs color paints ── */
  useEffect(() => {
    if (!sceneRef.current.scene) return;

    if (prevFrameIdxRef.current !== frameIdx) {
      buildGlasses(frameIdx, colorIdx);
      filterBankRef.current.reset();
      glassesOpacityRef.current = 0;
      prevFrameIdxRef.current = frameIdx;
    } else {
      updateGlassesColor(frameIdx, colorIdx);
    }
  }, [frameIdx, colorIdx, buildGlasses, updateGlassesColor]);

  /* ── initialize MediaPipe ── */
  const initFaceLandmarker = useCallback(async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );
      const fl = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });
      faceLandmarkerRef.current = fl;
      return true;
    } catch (err) {
      console.error("MediaPipe init error:", err);
      setCameraError("Failed to load AI model. Check your internet connection.");
      setStatus("error");
      return false;
    }
  }, []);

  /* ── start camera ── */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError("Camera access denied. Please allow camera permissions.");
      setStatus("error");
      return false;
    }
  }, []);

  /* ── stop everything ── */
  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const { renderer, scene, glasses } = sceneRef.current;
    if (glasses) {
      scene?.remove(glasses);
      glasses.traverse((ch) => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
    }
    if (renderer) renderer.dispose();
    if (threeContainerRef.current && renderer?.domElement) {
      try { threeContainerRef.current.removeChild(renderer.domElement); } catch (e) { /* ok */ }
    }
    sceneRef.current = {};
  }, []);

  /* ── Three.js setup ── */
  const initThreeJS = useCallback((width, height) => {
    const container = threeContainerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.4;
    container.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;";

    const fov = 50;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.01, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);

    const scene = new THREE.Scene();

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(1, 2, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.35);
    fill.position.set(-2, 1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, 1, -3);
    scene.add(rim);

    const zDist = 2;
    const vHeight = 2 * zDist * Math.tan((fov * Math.PI / 180) / 2);
    const vWidth = vHeight * aspect;

    sceneRef.current = { renderer, scene, camera, fov, zDist, vWidth, vHeight };
  }, []);

  /* ── MAIN LOOP ── */
  const startLoop = useCallback(() => {
    const fl = faceLandmarkerRef.current;
    const video = videoRef.current;
    const vCanvas = videoCanvasRef.current;
    if (!fl || !video || !vCanvas) return;

    const vCtx = vCanvas.getContext("2d");
    let lastTime = -1;
    let noFaceFrames = 0;

    const targetQuat = new THREE.Quaternion();
    const euler = new THREE.Euler(0, 0, 0, "ZYX");

    const loop = (now) => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2) return;

      if (now === lastTime) return;
      lastTime = now;

      const { renderer, scene, camera, zDist, glasses } = sceneRef.current;
      if (!renderer || !glasses) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vCanvas.width !== vw || vCanvas.height !== vh) {
        vCanvas.width = vw;
        vCanvas.height = vh;
        renderer.setSize(vCanvas.clientWidth, vCanvas.clientHeight);
        camera.aspect = vCanvas.clientWidth / vCanvas.clientHeight;
        camera.updateProjectionMatrix();
        const newVH = 2 * zDist * Math.tan((sceneRef.current.fov * Math.PI / 180) / 2);
        sceneRef.current.vHeight = newVH;
        sceneRef.current.vWidth = newVH * camera.aspect;
      }

      vCtx.save();
      vCtx.scale(-1, 1);
      vCtx.drawImage(video, -vw, 0, vw, vh);
      vCtx.restore();

      const result = fl.detectForVideo(video, now);
      const hasFace = result.faceLandmarks && result.faceLandmarks.length > 0;

      if (hasFace) {
        noFaceFrames = 0;
        targetOpacityRef.current = 1;
        setFaceDetected(true);

        const landmarks = result.faceLandmarks[0];
        const faceMatrix = result.facialTransformationMatrixes?.[0] || null;
        const pose = extractFacePose(landmarks, sceneRef.current.vWidth, sceneRef.current.vHeight, faceMatrix, faceWidth);
        const fb = filterBankRef.current;
        const t = now;

        const fpx    = fb.filter("px",    pose.px,          t);
        const fpy    = fb.filter("py",    pose.py,          t);
        const fscale = fb.filter("scale", pose.scale,       t);
        const froll  = fb.filter("roll",  pose.roll,        t);
        const fyaw   = fb.filter("yaw",   pose.yaw,         t);
        const fpitch = fb.filter("pitch", pose.pitch,       t);
        const fdepth = fb.filter("depth", pose.depthOffset, t);

        glasses.position.set(fpx, fpy, -zDist + fdepth);
        glasses.scale.setScalar(fscale);

        euler.set(fpitch, fyaw, froll);
        targetQuat.setFromEuler(euler);

        if (glasses.quaternion.dot(targetQuat) < 0) {
          targetQuat.x *= -1; targetQuat.y *= -1; targetQuat.z *= -1; targetQuat.w *= -1;
        }
        glasses.quaternion.slerp(targetQuat, 0.8);

      } else {
        noFaceFrames++;
        if (noFaceFrames > 10) {
          targetOpacityRef.current = 0;
          if (noFaceFrames > 25) {
            setFaceDetected(false);
            filterBankRef.current.reset();
          }
        }
      }

      const opacitySpeed = targetOpacityRef.current > glassesOpacityRef.current ? 0.3 : 0.1;
      glassesOpacityRef.current += (targetOpacityRef.current - glassesOpacityRef.current) * opacitySpeed;

      if (glassesOpacityRef.current > 0.01) {
        glasses.visible = true;
        glasses.traverse(child => {
          if (child.isMesh && child.material) {
            child.material.opacity = child.material.userData?._baseOpacity != null
              ? child.material.userData._baseOpacity * glassesOpacityRef.current
              : glassesOpacityRef.current;
            child.material.transparent = true;
          }
        });
      } else {
        glasses.visible = false;
      }

      renderer.render(scene, camera);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  /* ── START EVERYTHING ── */
  const handleStart = useCallback(async () => {
    setStatus("loading");
    setCapturedImage(null);
    setCameraError(null);

    const modelOk = faceLandmarkerRef.current || (await initFaceLandmarker());
    if (!modelOk) return;

    const camOk = await startCamera();
    if (!camOk) return;

    await new Promise((res) => {
      const check = () => {
        if (videoRef.current && videoRef.current.videoWidth > 0) return res();
        requestAnimationFrame(check);
      };
      check();
    });

    const container = threeContainerRef.current;
    const displayW = container?.clientWidth || videoRef.current.videoWidth;
    const displayH = container?.clientHeight || videoRef.current.videoHeight;

    initThreeJS(displayW, displayH);
    buildGlasses(frameIdx, colorIdx);     
    prevFrameIdxRef.current = frameIdx;     
    startLoop();
    setStatus("live");
  }, [initFaceLandmarker, startCamera, initThreeJS, startLoop]);

  useEffect(() => {
    handleStart();
    return cleanup;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── capture photo ── */
  const handleCapture = useCallback(() => {
    const vCanvas = videoCanvasRef.current;
    const { renderer } = sceneRef.current;
    if (!vCanvas || !renderer) return;

    const offscreen = document.createElement("canvas");
    offscreen.width = vCanvas.clientWidth * 2;
    offscreen.height = vCanvas.clientHeight * 2;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(vCanvas, 0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(renderer.domElement, 0, 0, offscreen.width, offscreen.height);

    ctx.font = `${offscreen.width * 0.018}px "DM Sans", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "right";
    ctx.fillText("OPTIQ AR Try-On", offscreen.width - 20, offscreen.height - 16);

    const dataUrl = offscreen.toDataURL("image/png");
    setCapturedImage(dataUrl);
    setStatus("captured");
  }, []);

  const handleDownload = useCallback(() => {
    if (!capturedImage) return;
    const a = document.createElement("a");
    a.href = capturedImage;
    a.download = `optiq-tryon-${AR_FRAMES[frameIdx].id}-${Date.now()}.png`;
    a.click();
  }, [capturedImage, frameIdx]);

  const handleDismissCapture = useCallback(() => {
    setCapturedImage(null);
    setStatus("live");
  }, []);

  useEffect(() => {
    const onResize = () => {
      const { renderer, camera, fov, zDist } = sceneRef.current;
      const container = threeContainerRef.current;
      if (!renderer || !container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      if (camera) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        const newVH = 2 * zDist * Math.tan((fov * Math.PI / 180) / 2);
        sceneRef.current.vHeight = newVH;
        sceneRef.current.vWidth = newVH * camera.aspect;
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div style={{ width: "100%", maxWidth: 900, margin: "0 auto", padding: "0 16px 80px" }}>
      <section style={{ paddingTop: 36, paddingBottom: 24, textAlign: "center" }}>
        <p style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", opacity: 0.3, marginBottom: 10, fontWeight: 600 }}>
          Augmented Reality
        </p>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(26px, 4vw, 40px)", fontWeight: 500, margin: "0 0 10px", lineHeight: 1.2 }}>
          Virtual Try-On
        </h1>
        <p style={{ fontSize: 13, opacity: 0.4, maxWidth: 460, margin: "0 auto" }}>
          See how each frame looks on your face in real-time. Powered by MediaPipe Face Mesh with 468-point tracking.
        </p>
      </section>

      <div style={{
        position: "relative", width: "100%", maxWidth: 640, margin: "0 auto",
        aspectRatio: "4/3", borderRadius: 20, overflow: "hidden",
        background: "#0a0a0c", border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 8px 60px rgba(0,0,0,0.4)",
      }}>
        <video ref={videoRef} playsInline muted style={{ display: "none" }} />

        <canvas ref={videoCanvasRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover",
          display: (status === "live" || status === "captured") ? "block" : "none",
        }} />

        <div ref={threeContainerRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          pointerEvents: "none",
          display: status === "live" ? "block" : "none",
        }} />

        {status === "captured" && capturedImage && (
          <img src={capturedImage} alt="Captured" style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            objectFit: "cover",
          }} />
        )}

        {(status === "idle" || status === "loading") && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 16,
          }}>
            {status === "idle" && (
              <>
                <div style={{ width: 80, height: 80, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>◎</div>
                <p style={{ fontSize: 13, opacity: 0.4 }}>Initializing AR...</p>
              </>
            )}
            {status === "loading" && (
              <>
                <div style={{ width: 36, height: 36, border: "2px solid rgba(111,207,151,0.3)", borderTopColor: "#6fcf97", borderRadius: "50%", animation: "gvSpin 0.8s linear infinite" }} />
                <p style={{ fontSize: 13, opacity: 0.5 }}>Loading face tracking model...</p>
              </>
            )}
          </div>
        )}

        {status === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
            <p style={{ fontSize: 14, opacity: 0.6, textAlign: "center", color: "#ff6b6b" }}>{cameraError}</p>
            <button onClick={handleStart} style={{
              padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
              background: "rgba(255,255,255,0.06)", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 12,
              fontWeight: 500, letterSpacing: 1, textTransform: "uppercase",
            }}>Try Again</button>
          </div>
        )}

        {status === "live" && !faceDetected && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
            animation: "arFadeIn 0.5s ease both", pointerEvents: "none",
          }}>
            <svg width="160" height="220" viewBox="0 0 160 220" style={{ opacity: 0.3 }}>
              <ellipse cx="80" cy="110" rx="60" ry="90" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="8 6" />
              <circle cx="55" cy="90" r="6" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="105" cy="90" r="6" fill="none" stroke="#fff" strokeWidth="1.2" />
              <path d="M70 130 Q80 140 90 130" fill="none" stroke="#fff" strokeWidth="1.2" />
            </svg>
            <p style={{ fontSize: 12, opacity: 0.5, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600, animation: "arPulse 2s ease-in-out infinite" }}>
              Position your face in frame
            </p>
          </div>
        )}

        {status === "live" && faceDetected && (
          <div style={{
            position: "absolute", top: 14, left: 14,
            display: "flex", alignItems: "center", gap: 6,
            padding: "5px 12px", borderRadius: 8,
            background: "rgba(0,0,0,0.4)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)",
            animation: "arFadeIn 0.3s ease both",
          }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#6fcf97", animation: "arPulse 2s ease-in-out infinite" }} />
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", opacity: 0.7 }}>LIVE</span>
          </div>
        )}

        {status === "captured" && (
          <div style={{
            position: "absolute", bottom: 0, left: 0, right: 0,
            padding: "20px", display: "flex", gap: 10,
            background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)",
            animation: "arSlideUp 0.3s ease both",
          }}>
            <button onClick={handleDismissCapture} style={{
              flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
              letterSpacing: 1.5, textTransform: "uppercase",
            }}>← Back</button>
            <button onClick={handleDownload} style={{
              flex: 2, padding: "12px 0", borderRadius: 10, cursor: "pointer",
              background: "rgba(111,207,151,0.9)", border: "none", color: "#000",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
              letterSpacing: 1.5, textTransform: "uppercase",
            }}>Download Photo</button>
          </div>
        )}
      </div>

      {(status === "live" || status === "captured") && (
        <div style={{ maxWidth: 640, margin: "0 auto", animation: "arSlideUp 0.4s ease both" }}>

          {status === "live" && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
              <button className="ar-capture-btn" onClick={handleCapture} style={{
                width: 64, height: 64, borderRadius: "50%", cursor: "pointer",
                background: "rgba(255,255,255,0.9)", border: "4px solid rgba(255,255,255,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 4px 24px rgba(0,0,0,0.3), inset 0 0 0 2px rgba(0,0,0,0.1)",
              }}>
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#fff", border: "2px solid rgba(0,0,0,0.1)" }} />
              </button>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.3, marginBottom: 10, fontWeight: 600, textAlign: "center" }}>
              Frame Style
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {AR_FRAMES.map((f, i) => (
                <button key={f.id} className="ar-frame-btn" onClick={() => { setFrameIdx(i); setColorIdx(0); }} style={{
                  padding: "12px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center",
                  border: frameIdx === i ? "1px solid rgba(255,255,255,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: frameIdx === i ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)",
                  color: "#fff", fontFamily: "'DM Sans', sans-serif",
                }}>
                  <span style={{ fontSize: 13, fontWeight: frameIdx === i ? 600 : 400, display: "block", marginBottom: 2 }}>{f.name.split(" ")[0]}</span>
                  <span style={{ fontSize: 10, opacity: 0.35 }}>{f.name.split(" ").slice(1).join(" ")}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.3, marginBottom: 10, fontWeight: 600, textAlign: "center" }}>
              Colour — {color.name}
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              {frame.colors.map((c, i) => (
                <button key={i} className="ar-swatch" onClick={() => setColorIdx(i)} style={{
                  width: 36, height: 36, borderRadius: "50%", cursor: "pointer",
                  background: hex(c.frame), border: colorIdx === i ? "3px solid #fff" : "3px solid rgba(255,255,255,0.15)",
                  boxShadow: colorIdx === i ? "0 0 16px rgba(255,255,255,0.2)" : "none",
                  padding: 0,
                }} />
              ))}
            </div>
          </div>

          {onBack && (
            <div style={{ marginTop: 24, textAlign: "center" }}>
              <button className="ar-back-btn" onClick={() => { cleanup(); onBack(); }} style={{
                padding: "12px 28px", borderRadius: 10, cursor: "pointer",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff",
                fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 600,
                letterSpacing: 1.5, textTransform: "uppercase",
              }}>
                ← Back to Configurator
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}