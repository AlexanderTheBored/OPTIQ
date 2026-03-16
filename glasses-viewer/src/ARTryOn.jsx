import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/* ═══════════════════════════════════════════════════════════
   GEOMETRY HELPERS (duplicated from GlassesViewer for
   self-containment — extract to shared module in production)
   ═══════════════════════════════════════════════════════════ */
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

/* ═══════════════════════════════════════════════════════════
   FRAME DATA (minimal subset for AR)
   ═══════════════════════════════════════════════════════════ */
const MATERIAL_PBR = { metalness: 0.05, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 };

const AR_FRAMES = [
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
   FACE POSE HELPERS
   ═══════════════════════════════════════════════════════════ */
const LM = {
  noseBridge: 168,      /* top of nose bridge between eyes — more stable than 6 */
  noseTip: 4,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  leftEyeInner: 133,
  rightEyeInner: 362,
  leftTemple: 234,
  rightTemple: 454,
  foreHead: 10,
  chin: 152,
  leftCheek: 127,
  rightCheek: 356,
};

const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function dist2D(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }

/* ═══════════════════════════════════════════════════════════
   ONE EURO FILTER — adaptive smoothing that kills jitter
   when still but stays responsive during fast head movement.
   Replaces the old simple EMA Smoother.
   ═══════════════════════════════════════════════════════════ */
class LowPassFilter {
  constructor(alpha) {
    this.y = null;
    this.s = null;
    this.setAlpha(alpha);
  }
  setAlpha(alpha) {
    this.alpha = Math.max(0.001, Math.min(1, alpha));
  }
  filter(value) {
    if (this.y === null) {
      this.y = value;
      this.s = value;
      return value;
    }
    this.y = value;
    this.s = this.alpha * value + (1 - this.alpha) * this.s;
    return this.s;
  }
  hatValue() { return this.s; }
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
    if (this.lastTime !== null && timestamp !== undefined) {
      const dt = timestamp - this.lastTime;
      if (dt > 0) this.freq = 1.0 / (dt / 1000);
    }
    this.lastTime = timestamp;

    const prev = this.x.hatValue();
    const dx = prev === null ? 0 : (value - prev) * this.freq;
    const edx = this.dx.filter(dx);
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

/**
 * Drop-in replacement for the old Smoother.
 * Same .smooth(key, value) API but backed by per-channel One Euro Filters.
 */
class Smoother {
  constructor() {
    this.filters = {};
  }

  smooth(key, value, timestamp) {
    if (!this.filters[key]) {
      const isRotation = ["roll", "yaw", "pitch"].includes(key);
      const isScale = key === "scale";
      this.filters[key] = new OneEuroFilter(
        30,
        isRotation ? 1.5 : isScale ? 0.8 : 1.0,
        isRotation ? 0.004 : isScale ? 0.003 : 0.007,
        1.0
      );
    }
    return this.filters[key].filter(value, timestamp);
  }

  reset() {
    Object.values(this.filters).forEach((f) => f.reset());
    this.filters = {};
  }
}

/* ═══════════════════════════════════════════════════════════
   ASPECT RATIO CROP MAPPING
   
   Computes how CSS object-fit:cover crops the video so we
   can correctly map MediaPipe landmarks (full video space)
   to the display container. Fixes the 1080p camera bug.
   ═══════════════════════════════════════════════════════════ */
function computeCrop(videoW, videoH, containerW, containerH) {
  const videoAspect = videoW / videoH;
  const containerAspect = containerW / containerH;

  let visibleFracX = 1;
  let visibleFracY = 1;
  let offsetX = 0;
  let offsetY = 0;

  if (videoAspect > containerAspect) {
    /* video wider than container → horizontal crop */
    visibleFracX = containerAspect / videoAspect;
    offsetX = (1 - visibleFracX) / 2;
  } else {
    /* video taller than container → vertical crop */
    visibleFracY = videoAspect / containerAspect;
    offsetY = (1 - visibleFracY) / 2;
  }

  return { offsetX, offsetY, visibleFracX, visibleFracY };
}

/* ═══════════════════════════════════════════════════════════
   POSE EXTRACTION — uses MediaPipe transformation matrix
   when available, falls back to improved landmark math.
   ═══════════════════════════════════════════════════════════ */
function extractFacePose(landmarks, vWidth, vHeight, crop, matrix) {
  const bridge = landmarks[LM.noseBridge];
  const leftEyeOuter = landmarks[LM.leftEyeOuter];
  const rightEyeOuter = landmarks[LM.rightEyeOuter];
  const leftTemple = landmarks[LM.leftTemple];
  const rightTemple = landmarks[LM.rightTemple];
  const forehead = landmarks[LM.foreHead];
  const chin = landmarks[LM.chin];

  /* ── POSITION — map through crop for aspect ratio correction ── */
  const mappedX = (bridge.x - crop.offsetX) / crop.visibleFracX;
  const mappedY = (bridge.y - crop.offsetY) / crop.visibleFracY;
  const px = (0.5 - mappedX) * vWidth;
  const py = -(mappedY - 0.5) * vHeight;

  /* ── SCALE — outer eye distance is more stable than temples ── */
  const eyeDistNorm = dist2D(leftEyeOuter, rightEyeOuter);
  const eyeDistWorld = (eyeDistNorm / crop.visibleFracX) * vWidth;
  const modelEyeSpan = 1.08;
  const scale = (eyeDistWorld / modelEyeSpan) * 0.95;

  /* ── ROTATION ── */
  let roll, yaw, pitch;

  if (matrix) {
    /* Use MediaPipe's 4×4 transformation matrix — far more stable */
    const m = matrix.data;
    pitch = Math.asin(-Math.max(-1, Math.min(1, m[6])));

    if (Math.abs(m[6]) < 0.999) {
      yaw = Math.atan2(m[2], m[10]);
      roll = Math.atan2(m[4], m[5]);
    } else {
      yaw = Math.atan2(-m[8], m[0]);
      roll = 0;
    }

    yaw = -yaw;
    roll = -roll;
  } else {
    /* Fallback: improved landmark-based estimation */
    roll = -Math.atan2(
      rightEyeOuter.y - leftEyeOuter.y,
      rightEyeOuter.x - leftEyeOuter.x
    );

    /* Yaw from z-depth difference — much more stable than 2D nose offset */
    const leftZ = leftTemple.z || 0;
    const rightZ = rightTemple.z || 0;
    const zDiff = rightZ - leftZ;
    const faceWidthNorm = dist2D(leftTemple, rightTemple);
    yaw = Math.asin(
      Math.max(-0.8, Math.min(0.8, zDiff / (faceWidthNorm * 0.8)))
    );

    /* Pitch from bridge-to-forehead ratio */
    const faceH = dist2D(forehead, chin) || 0.001;
    const bridgeToForehead = dist2D(bridge, forehead);
    const ratio = bridgeToForehead / faceH;
    pitch = (ratio - 0.32) * 1.8;
  }

  /* ── DEPTH ── */
  const depthOffset = (bridge.z || 0) * 0.4;

  return { px, py, scale, roll, yaw, pitch, depthOffset };
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function ARTryOn({ onBack }) {
  const videoRef = useRef(null);
  const videoCanvasRef = useRef(null);
  const threeContainerRef = useRef(null);
  const sceneRef = useRef({});
  const smootherRef = useRef(new Smoother()); /* ← no args, One Euro handles it */
  const faceLandmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const [status, setStatus] = useState("idle"); /* idle | loading | live | error | captured */
  const [frameIdx, setFrameIdx] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const [faceDetected, setFaceDetected] = useState(false);
  const [capturedImage, setCapturedImage] = useState(null);
  const [cameraError, setCameraError] = useState(null);

  const frame = AR_FRAMES[frameIdx];
  const color = frame.colors[colorIdx];

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
  const buildGlasses = useCallback((fIdx, cIdx) => {
    const { scene, glasses: old } = sceneRef.current;
    if (!scene) return;
    if (old) {
      scene.remove(old);
      old.traverse((ch) => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
    }
    const f = AR_FRAMES[fIdx];
    const c = f.colors[cIdx];
    const glasses = f.build(c, MATERIAL_PBR);
    glasses.visible = false; /* hidden until face detected */
    scene.add(glasses);
    sceneRef.current.glasses = glasses;
  }, []);

  /* ── rebuild when frame/color changes ── */
  useEffect(() => {
    if (sceneRef.current.scene) {
      buildGlasses(frameIdx, colorIdx);
      smootherRef.current.reset();
    }
  }, [frameIdx, colorIdx, buildGlasses]);

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
        outputFacialTransformationMatrixes: true, /* ← FIX: was false — enables 4×4 pose matrix */
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
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          /* FIX: removed height: { ideal: 960 } — was forcing 4:3,
             which fails or causes crop mismatch on 16:9 (1080p) cameras.
             Let the camera use its native aspect ratio. */
        },
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

    /* lighting — designed to look natural on transparent overlay */
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.4);
    fill.position.set(-2, 1, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(0, 1, -3);
    scene.add(rim);

    /* working-distance geometry — at z=-2, compute visible size */
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
    let noFaceCount = 0;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2) return;

      const now = performance.now();
      if (now === lastTime) return;
      lastTime = now;

      const { renderer, scene, camera, zDist, glasses } = sceneRef.current;
      if (!renderer || !glasses) return;

      /* resize canvas to match video */
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vCanvas.width !== vw || vCanvas.height !== vh) {
        vCanvas.width = vw;
        vCanvas.height = vh;
        renderer.setSize(vCanvas.clientWidth, vCanvas.clientHeight);
        camera.aspect = vCanvas.clientWidth / vCanvas.clientHeight;
        camera.updateProjectionMatrix();
        /* recalculate visible dimensions */
        const newVH = 2 * zDist * Math.tan((sceneRef.current.fov * Math.PI / 180) / 2);
        sceneRef.current.vHeight = newVH;
        sceneRef.current.vWidth = newVH * camera.aspect;
      }

      /* ── FIX: crop-aware video drawing ──
         Compute the crop so the canvas shows the same region
         the container would show via CSS object-fit:cover. */
      const crop = computeCrop(vw, vh, vCanvas.clientWidth, vCanvas.clientHeight);
      const sx = crop.offsetX * vw;
      const sy = crop.offsetY * vh;
      const sw = crop.visibleFracX * vw;
      const sh = crop.visibleFracY * vh;

      vCtx.save();
      vCtx.scale(-1, 1); /* mirror for selfie */
      vCtx.drawImage(video, sx, sy, sw, sh, -vw, 0, vw, vh);
      vCtx.restore();

      /* detect face */
      const result = fl.detectForVideo(video, now);
      const hasFace = result.faceLandmarks && result.faceLandmarks.length > 0;

      if (hasFace) {
        noFaceCount = 0;
        setFaceDetected(true);

        const landmarks = result.faceLandmarks[0];

        /* ── FIX: get transformation matrix for stable rotation ── */
        const matrix =
          result.facialTransformationMatrixes &&
          result.facialTransformationMatrixes.length > 0
            ? result.facialTransformationMatrixes[0]
            : null;

        /* ── FIX: pass crop + matrix to pose extraction ── */
        const pose = extractFacePose(
          landmarks,
          sceneRef.current.vWidth,
          sceneRef.current.vHeight,
          crop,
          matrix
        );

        const sm = smootherRef.current;

        /* smooth all values — pass timestamp for adaptive filtering */
        const spx = sm.smooth("px", pose.px, now);
        const spy = sm.smooth("py", pose.py, now);
        const sscale = sm.smooth("scale", pose.scale, now);
        const sroll = sm.smooth("roll", pose.roll, now);
        const syaw = sm.smooth("yaw", pose.yaw, now);
        const spitch = sm.smooth("pitch", pose.pitch, now);
        const sdepth = sm.smooth("depth", pose.depthOffset, now);

        glasses.visible = true;
        glasses.position.set(spx, spy, -zDist + sdepth);
        glasses.scale.setScalar(sscale);
        glasses.rotation.order = "ZYX";
        glasses.rotation.set(spitch, syaw, sroll);
      } else {
        noFaceCount++;
        /* hide after 15 frames of no face (~0.5s) */
        if (noFaceCount > 15) {
          glasses.visible = false;
          setFaceDetected(false);
          smootherRef.current.reset();
        }
      }

      renderer.render(scene, camera);
    };

    loop();
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

    /* wait for video dimensions to be available */
    await new Promise((res) => {
      const check = () => {
        if (videoRef.current && videoRef.current.videoWidth > 0) return res();
        requestAnimationFrame(check);
      };
      check();
    });

    const vw = videoRef.current.videoWidth;
    const vh = videoRef.current.videoHeight;
    const container = threeContainerRef.current;
    const displayW = container?.clientWidth || vw;
    const displayH = container?.clientHeight || vh;

    initThreeJS(displayW, displayH);
    buildGlasses(frameIdx, colorIdx);
    startLoop();
    setStatus("live");
  }, [initFaceLandmarker, startCamera, initThreeJS, buildGlasses, startLoop, frameIdx, colorIdx]);

  /* auto-start on mount */
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

    /* composite both canvases */
    const offscreen = document.createElement("canvas");
    offscreen.width = vCanvas.clientWidth * 2; /* high-res capture */
    offscreen.height = vCanvas.clientHeight * 2;
    const ctx = offscreen.getContext("2d");
    ctx.drawImage(vCanvas, 0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(renderer.domElement, 0, 0, offscreen.width, offscreen.height);

    /* watermark */
    ctx.font = `${offscreen.width * 0.018}px "DM Sans", sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign = "right";
    ctx.fillText("ReSight AR Try-On", offscreen.width - 20, offscreen.height - 16);

    const dataUrl = offscreen.toDataURL("image/png");
    setCapturedImage(dataUrl);
    setStatus("captured");
  }, []);

  /* ── download captured photo ── */
  const handleDownload = useCallback(() => {
    if (!capturedImage) return;
    const a = document.createElement("a");
    a.href = capturedImage;
    a.download = `resight-tryon-${AR_FRAMES[frameIdx].id}-${Date.now()}.png`;
    a.click();
  }, [capturedImage, frameIdx]);

  /* ── dismiss capture and go back to live ── */
  const handleDismissCapture = useCallback(() => {
    setCapturedImage(null);
    setStatus("live");
  }, []);

  /* ── handle resize ── */
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

      {/* HEADER */}
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

      {/* AR VIEWPORT */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 640, margin: "0 auto",
        aspectRatio: "4/3", borderRadius: 20, overflow: "hidden",
        background: "#0a0a0c", border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 8px 60px rgba(0,0,0,0.4)",
      }}>
        {/* hidden video element */}
        <video ref={videoRef} playsInline muted style={{ display: "none" }} />

        {/* video canvas */}
        <canvas ref={videoCanvasRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover",
          display: (status === "live" || status === "captured") ? "block" : "none",
        }} />

        {/* three.js overlay container */}
        <div ref={threeContainerRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          pointerEvents: "none",
          display: status === "live" ? "block" : "none",
        }} />

        {/* captured image overlay */}
        {status === "captured" && capturedImage && (
          <img src={capturedImage} alt="Captured" style={{
            position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
            objectFit: "cover",
          }} />
        )}

        {/* ── IDLE / LOADING ── */}
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

        {/* ── ERROR ── */}
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

        {/* ── FACE NOT DETECTED HINT ── */}
        {status === "live" && !faceDetected && (
          <div style={{
            position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            animation: "arFadeIn 0.5s ease both", pointerEvents: "none",
          }}>
            {/* face oval guide */}
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

        {/* ── LIVE STATUS BADGE ── */}
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

        {/* ── CAPTURED OVERLAY CONTROLS ── */}
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

      {/* ══════════════ CONTROLS BELOW VIEWPORT ══════════════ */}
      {(status === "live" || status === "captured") && (
        <div style={{ maxWidth: 640, margin: "0 auto", animation: "arSlideUp 0.4s ease both" }}>

          {/* capture button */}
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

          {/* frame selector */}
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

          {/* colour swatches */}
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

          {/* back to configurator */}
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

          {/* tech note */}
          <div style={{ marginTop: 32, padding: "16px 20px", borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.2, margin: "0 0 8px", fontWeight: 600 }}>How It Works</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                { n: "01", t: "Track", d: "468 facial landmarks detected at 30fps using MediaPipe Face Mesh" },
                { n: "02", t: "Pose", d: "4×4 transformation matrix extracts head position, rotation & scale" },
                { n: "03", t: "Render", d: "Three.js overlays the 3D glasses model in real-time on the camera feed" },
              ].map((s, i) => (
                <div key={i}>
                  <p style={{ fontSize: 9, opacity: 0.2, fontFamily: "'JetBrains Mono', monospace", margin: "0 0 3px" }}>{s.n}</p>
                  <p style={{ fontSize: 11, fontWeight: 600, margin: "0 0 3px" }}>{s.t}</p>
                  <p style={{ fontSize: 10, opacity: 0.3, margin: 0, lineHeight: 1.5 }}>{s.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}