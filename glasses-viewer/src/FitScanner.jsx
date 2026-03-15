import { useEffect, useRef, useState, useCallback } from "react";
import { FaceLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

/* ═══════════════════════════════════════════════════════════
   FACE MEASUREMENT HELPERS

   MediaPipe Face Mesh landmarks we use:
   - 454/234: left/right temple (face width)
   - 6/168: nose bridge top area
   - 4: nose tip
   - 10/152: forehead top / chin bottom (face height)
   - 127/356: outer cheekbones
   - 46/276: inner eye corners (bridge width)

   Reference: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png
   ═══════════════════════════════════════════════════════════ */

const LANDMARK = {
  leftTemple: 234,
  rightTemple: 454,
  leftCheek: 127,
  rightCheek: 356,
  leftEyeInner: 133,
  rightEyeInner: 362,
  leftEyeOuter: 33,
  rightEyeOuter: 263,
  foreheadTop: 10,
  chinBottom: 152,
  noseBridgeTop: 6,
  noseTip: 4,
};

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + ((a.z || 0) - (b.z || 0)) ** 2);
}

/* convert normalized landmark distance to approximate mm using IPD as reference */
/* average adult inter-pupillary distance is ~63mm */
function computeMeasurements(landmarks) {
  const lm = (idx) => landmarks[idx];

  const leftEyeOuter = lm(LANDMARK.leftEyeOuter);
  const rightEyeOuter = lm(LANDMARK.rightEyeOuter);
  const leftEyeInner = lm(LANDMARK.leftEyeInner);
  const rightEyeInner = lm(LANDMARK.rightEyeInner);
  const leftTemple = lm(LANDMARK.leftTemple);
  const rightTemple = lm(LANDMARK.rightTemple);
  const foreheadTop = lm(LANDMARK.foreheadTop);
  const chinBottom = lm(LANDMARK.chinBottom);
  const leftCheek = lm(LANDMARK.leftCheek);
  const rightCheek = lm(LANDMARK.rightCheek);

  /* use distance between outer eye corners as calibration reference (~85mm average) */
  const eyeOuterDist = dist(leftEyeOuter, rightEyeOuter);
  const mmPerUnit = 85 / eyeOuterDist;

  const faceWidth = dist(leftTemple, rightTemple) * mmPerUnit;
  const bridgeWidth = dist(leftEyeInner, rightEyeInner) * mmPerUnit;
  const faceHeight = dist(foreheadTop, chinBottom) * mmPerUnit;
  const cheekWidth = dist(leftCheek, rightCheek) * mmPerUnit;

  /* face shape classification */
  const ratio = faceWidth / faceHeight;
  let faceShape;
  if (ratio > 0.85) faceShape = "round";
  else if (ratio > 0.78) faceShape = "square";
  else if (ratio > 0.72) faceShape = "oval";
  else faceShape = "oblong";

  return {
    faceWidth: Math.round(faceWidth),
    bridgeWidth: Math.round(bridgeWidth),
    faceHeight: Math.round(faceHeight),
    cheekWidth: Math.round(cheekWidth),
    faceShape,
    ratio: ratio.toFixed(2),
  };
}

/* recommend size and frame based on measurements */
function getRecommendation(m) {
  let size, sizeIdx;
  if (m.faceWidth < 130) { size = "Small"; sizeIdx = 0; }
  else if (m.faceWidth < 140) { size = "Medium"; sizeIdx = 1; }
  else { size = "Large"; sizeIdx = 2; }

  /* frame style recommendation based on face shape */
  const frameRecs = {
    round: { primary: 1, name: "Wayfarer Bold", reason: "Angular frames balance round features and add definition." },
    square: { primary: 0, name: "Aviator Classic", reason: "Curved teardrop shape softens strong jawlines and angular features." },
    oval: { primary: 2, name: "Round Wire", reason: "Oval faces suit almost anything. Round frames complement your balanced proportions." },
    oblong: { primary: 3, name: "Cat-Eye Luxe", reason: "Wider frames with upswept corners add width and balance a longer face." },
  };

  const rec = frameRecs[m.faceShape] || frameRecs.oval;

  return { size, sizeIdx, frameIdx: rec.primary, frameName: rec.name, reason: rec.reason };
}

/* ═══════════════════════════════════════════════════════════
   SCANNING ANIMATION RING
   ═══════════════════════════════════════════════════════════ */
function ScanRing({ active, progress }) {
  const r = 120;
  const circ = 2 * Math.PI * r;
  return (
    <svg width="280" height="280" viewBox="0 0 280 280" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none", opacity: active ? 1 : 0, transition: "opacity 0.5s" }}>
      {/* background ring */}
      <circle cx="140" cy="140" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
      {/* progress ring */}
      <circle cx="140" cy="140" r={r} fill="none" stroke="#6fcf97" strokeWidth="2.5"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)}
        strokeLinecap="round" transform="rotate(-90 140 140)"
        style={{ transition: "stroke-dashoffset 0.3s ease" }} />
      {/* corner brackets */}
      {[
        "M60 85 L60 60 L85 60",
        "M195 60 L220 60 L220 85",
        "M220 195 L220 220 L195 220",
        "M85 220 L60 220 L60 195",
      ].map((d, i) => (
        <path key={i} d={d} fill="none" stroke="rgba(111,207,151,0.5)" strokeWidth="2" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function FitScanner({ onApplyFit }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);

  const [status, setStatus] = useState("idle"); /* idle | loading | scanning | complete | error */
  const [measurements, setMeasurements] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [scanProgress, setScanProgress] = useState(0);
  const [stableSamples, setStableSamples] = useState([]);
  const [cameraError, setCameraError] = useState(null);

  const SAMPLES_NEEDED = 20;

  /* ── initialize MediaPipe ── */
  const initFaceLandmarker = useCallback(async () => {
    setStatus("loading");
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
        outputFacialTransformationMatrixes: false,
      });
      faceLandmarkerRef.current = fl;
      return true;
    } catch (err) {
      console.error("MediaPipe init error:", err);
      setStatus("error");
      setCameraError("Failed to load AI model. Check your internet connection.");
      return false;
    }
  }, []);

  /* ── start camera ── */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError("Camera access denied. Please allow camera permissions and try again.");
      setStatus("error");
      return false;
    }
  }, []);

  /* ── stop camera ── */
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  /* ── run detection loop ── */
  const startDetection = useCallback(() => {
    const fl = faceLandmarkerRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!fl || !video || !canvas) return;

    const ctx = canvas.getContext("2d");
    const samples = [];
    let lastTime = -1;

    const detect = () => {
      animFrameRef.current = requestAnimationFrame(detect);
      if (video.readyState < 2) return;
      const now = performance.now();
      if (now === lastTime) return;
      lastTime = now;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const result = fl.detectForVideo(video, now);

      /* draw video */
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
      ctx.restore();

      if (result.faceLandmarks && result.faceLandmarks.length > 0) {
        const landmarks = result.faceLandmarks[0];

        /* draw mesh with subtle dots */
        ctx.save();
        ctx.scale(-1, 1);
        ctx.translate(-canvas.width, 0);

        /* draw key measurement lines */
        const drawLine = (idx1, idx2, color) => {
          const a = landmarks[idx1];
          const b = landmarks[idx2];
          ctx.beginPath();
          ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
          ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          /* dots at endpoints */
          [a, b].forEach((p) => {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
          });
        };

        /* face width */
        drawLine(LANDMARK.leftTemple, LANDMARK.rightTemple, "rgba(111,207,151,0.7)");
        /* bridge width */
        drawLine(LANDMARK.leftEyeInner, LANDMARK.rightEyeInner, "rgba(78,205,196,0.7)");
        /* face height */
        drawLine(LANDMARK.foreheadTop, LANDMARK.chinBottom, "rgba(168,237,234,0.4)");

        /* subtle face mesh dots */
        landmarks.forEach((lm, i) => {
          if (i % 6 !== 0) return;
          ctx.beginPath();
          ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 1, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.fill();
        });

        ctx.restore();

        /* accumulate stable samples */
        const m = computeMeasurements(landmarks);
        samples.push(m);
        setScanProgress(Math.min(samples.length / SAMPLES_NEEDED, 1));
        setStableSamples([...samples]);

        if (samples.length >= SAMPLES_NEEDED) {
          /* average all samples for stability */
          const avg = {
            faceWidth: Math.round(samples.reduce((s, m) => s + m.faceWidth, 0) / samples.length),
            bridgeWidth: Math.round(samples.reduce((s, m) => s + m.bridgeWidth, 0) / samples.length),
            faceHeight: Math.round(samples.reduce((s, m) => s + m.faceHeight, 0) / samples.length),
            cheekWidth: Math.round(samples.reduce((s, m) => s + m.cheekWidth, 0) / samples.length),
            faceShape: samples[Math.floor(samples.length / 2)].faceShape,
            ratio: (samples.reduce((s, m) => s + parseFloat(m.ratio), 0) / samples.length).toFixed(2),
          };

          setMeasurements(avg);
          setRecommendation(getRecommendation(avg));
          setStatus("complete");
          cancelAnimationFrame(animFrameRef.current);
        }
      }
    };

    setStatus("scanning");
    detect();
  }, []);

  /* ── main start flow ── */
  const handleStart = useCallback(async () => {
    setScanProgress(0);
    setMeasurements(null);
    setRecommendation(null);
    setStableSamples([]);
    setCameraError(null);

    const modelOk = faceLandmarkerRef.current || (await initFaceLandmarker());
    if (!modelOk) return;

    const camOk = await startCamera();
    if (!camOk) return;

    /* small delay to let camera warm up */
    setTimeout(() => startDetection(), 500);
  }, [initFaceLandmarker, startCamera, startDetection]);

  /* cleanup on unmount */
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  /* ── rescan ── */
  const handleRescan = useCallback(() => {
    setStatus("idle");
    stopCamera();
    handleStart();
  }, [handleStart, stopCamera]);

  return (
    <div style={{ width: "100%", maxWidth: 900, margin: "0 auto", padding: "0 24px 80px", textAlign: "left" }}>

      {/* HEADER */}
      <section style={{ paddingTop: 48, paddingBottom: 32, textAlign: "center" }}>
        <p style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", opacity: 0.3, marginBottom: 12, fontWeight: 600 }}>
          AI-Powered
        </p>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 500, margin: "0 0 12px", lineHeight: 1.2 }}>
          Face Fit Scanner
        </h1>
        <p style={{ fontSize: 14, opacity: 0.4, maxWidth: 480, margin: "0 auto" }}>
          Our AI measures your face in real-time using MediaPipe Face Mesh to recommend the perfect frame size and style. No optician visit needed.
        </p>
      </section>

      {/* CAMERA VIEWPORT */}
      <div style={{ position: "relative", width: "100%", maxWidth: 560, margin: "0 auto 32px", aspectRatio: "4/3", borderRadius: 20, overflow: "hidden", background: "#0a0a0c", border: "1px solid rgba(255,255,255,0.06)" }}>

        {/* video + canvas (hidden until started) */}
        <video ref={videoRef} playsInline muted style={{ display: "none" }} />
        <canvas ref={canvasRef} style={{
          width: "100%", height: "100%", objectFit: "cover", display: status === "scanning" || status === "complete" ? "block" : "none",
        }} />

        {/* scan ring overlay */}
        {status === "scanning" && <ScanRing active={true} progress={scanProgress} />}

        {/* idle state */}
        {status === "idle" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", border: "2px solid rgba(111,207,151,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
              ◎
            </div>
            <p style={{ fontSize: 14, opacity: 0.5, textAlign: "center" }}>Position your face in front of the camera</p>
            <button onClick={handleStart} style={{
              padding: "14px 36px", borderRadius: 10, border: "none", cursor: "pointer",
              background: "rgba(111,207,151,0.9)", color: "#000",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600,
              letterSpacing: 1.5, textTransform: "uppercase", transition: "all 0.3s",
            }}>
              Start Scan
            </button>
          </div>
        )}

        {/* loading state */}
        {status === "loading" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
            <div style={{ width: 32, height: 32, border: "2px solid rgba(111,207,151,0.3)", borderTopColor: "#6fcf97", borderRadius: "50%", animation: "gvSpin 0.8s linear infinite" }} />
            <p style={{ fontSize: 13, opacity: 0.5 }}>Loading AI model...</p>
          </div>
        )}

        {/* error state */}
        {status === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
            <p style={{ fontSize: 14, opacity: 0.6, textAlign: "center", color: "#ff6b6b" }}>{cameraError}</p>
            <button onClick={handleStart} style={{
              padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer",
              background: "rgba(255,255,255,0.06)", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500,
              letterSpacing: 1, textTransform: "uppercase",
            }}>
              Try Again
            </button>
          </div>
        )}

        {/* scanning status bar */}
        {status === "scanning" && (
          <div style={{ position: "absolute", bottom: 16, left: 16, right: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.5, fontWeight: 600 }}>Analyzing face</span>
              <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", opacity: 0.5 }}>{Math.round(scanProgress * 100)}%</span>
            </div>
            <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ height: "100%", borderRadius: 2, background: "#6fcf97", width: `${scanProgress * 100}%`, transition: "width 0.3s ease" }} />
            </div>
          </div>
        )}

        {/* complete overlay */}
        {status === "complete" && (
          <div style={{ position: "absolute", top: 16, left: 16, display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 8, background: "rgba(111,207,151,0.15)", border: "1px solid rgba(111,207,151,0.3)" }}>
            <span style={{ color: "#6fcf97", fontSize: 14 }}>✓</span>
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", color: "#6fcf97" }}>Scan Complete</span>
          </div>
        )}
      </div>

      {/* RESULTS */}
      {status === "complete" && measurements && recommendation && (
        <div style={{ maxWidth: 560, margin: "0 auto" }}>

          {/* measurements grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
            {[
              { label: "Face Width", value: `${measurements.faceWidth}mm`, color: "rgba(111,207,151,0.7)" },
              { label: "Bridge", value: `${measurements.bridgeWidth}mm`, color: "rgba(78,205,196,0.7)" },
              { label: "Face Height", value: `${measurements.faceHeight}mm`, color: "rgba(168,237,234,0.5)" },
              { label: "Face Shape", value: measurements.faceShape, color: "rgba(255,255,255,0.4)" },
            ].map((m, i) => (
              <div key={i} style={{
                padding: "14px 12px", borderRadius: 12, textAlign: "center",
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
              }}>
                <p style={{ fontSize: 9, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.35, margin: "0 0 6px", fontWeight: 600 }}>{m.label}</p>
                <p style={{ fontSize: 18, fontWeight: 600, margin: 0, fontFamily: "'Playfair Display', serif", color: m.color }}>{m.value}</p>
              </div>
            ))}
          </div>

          {/* recommendation card */}
          <div style={{
            padding: "24px", borderRadius: 16,
            background: "rgba(111,207,151,0.04)", border: "1px solid rgba(111,207,151,0.12)",
            marginBottom: 16,
          }}>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.4, margin: "0 0 12px", fontWeight: 600, color: "#6fcf97" }}>
              AI Recommendation
            </p>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <p style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", fontFamily: "'Playfair Display', serif" }}>
                  {recommendation.frameName}
                </p>
                <p style={{ fontSize: 13, opacity: 0.5, margin: "0 0 12px" }}>
                  Size: <strong style={{ opacity: 1 }}>{recommendation.size}</strong>
                </p>
                <p style={{ fontSize: 13, lineHeight: 1.7, opacity: 0.45, margin: 0 }}>
                  {recommendation.reason}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                  <p style={{ fontSize: 9, opacity: 0.3, margin: "0 0 2px", letterSpacing: 1, textTransform: "uppercase" }}>Face shape</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0, textTransform: "capitalize" }}>{measurements.faceShape}</p>
                </div>
                <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                  <p style={{ fontSize: 9, opacity: 0.3, margin: "0 0 2px", letterSpacing: 1, textTransform: "uppercase" }}>W/H Ratio</p>
                  <p style={{ fontSize: 14, fontWeight: 600, margin: 0, fontFamily: "'JetBrains Mono', monospace" }}>{measurements.ratio}</p>
                </div>
              </div>
            </div>
          </div>

          {/* action buttons */}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleRescan} style={{
              flex: 1, padding: "14px 0", borderRadius: 10, cursor: "pointer",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
              letterSpacing: 1.5, textTransform: "uppercase", transition: "all 0.3s",
            }}>
              Rescan
            </button>
            <button onClick={() => {
              stopCamera();
              if (onApplyFit) onApplyFit(recommendation.frameIdx, recommendation.sizeIdx);
            }} style={{
              flex: 2, padding: "14px 0", borderRadius: 10, cursor: "pointer",
              background: "rgba(111,207,151,0.9)", border: "none", color: "#000",
              fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600,
              letterSpacing: 1.5, textTransform: "uppercase", transition: "all 0.3s",
            }}>
              Use This Fit
            </button>
          </div>

          {/* how it works footer */}
          <div style={{ marginTop: 32, padding: "20px 24px", borderRadius: 14, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <p style={{ fontSize: 10, letterSpacing: 2, textTransform: "uppercase", opacity: 0.25, margin: "0 0 10px", fontWeight: 600 }}>How This Works</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
              {[
                { step: "01", title: "Detect", desc: "MediaPipe Face Mesh identifies 468 facial landmarks in real-time" },
                { step: "02", title: "Measure", desc: "Key distances (face width, bridge, proportions) are calculated from landmark positions" },
                { step: "03", title: "Recommend", desc: "AI matches your measurements to the best frame size and style" },
              ].map((s, i) => (
                <div key={i}>
                  <p style={{ fontSize: 9, opacity: 0.2, fontFamily: "'JetBrains Mono', monospace", margin: "0 0 4px" }}>{s.step}</p>
                  <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 4px" }}>{s.title}</p>
                  <p style={{ fontSize: 11, opacity: 0.35, margin: 0, lineHeight: 1.5 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
