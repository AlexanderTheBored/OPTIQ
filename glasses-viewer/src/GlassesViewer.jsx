import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as THREE from "three";
import ImpactPage from "./ImpactPage";
import FitScanner from "./FitScanner";

const lerp = (a, b, t) => a + (b - a) * t;
const deg = (d) => (d * Math.PI) / 180;
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

if (typeof document !== "undefined") {
  const fl = document.createElement("link"); fl.rel = "stylesheet";
  fl.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
  document.head.appendChild(fl);
}

/* ═══════════════════════════════════════════════════════════
   CONFIGURATOR DATA
   ═══════════════════════════════════════════════════════════ */
const MATERIALS = [
  { id: "rhdpe", name: "Recycled HDPE", tag: "Bottle Caps", price: 0, desc: "Made from post-consumer bottle caps. Durable, lightweight, water-resistant.", co2: "82% less CO2 vs virgin plastic", icon: "♻",
    pbr: { metalness: 0.05, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 } },
  { id: "rpet", name: "Recycled PET", tag: "Bottles", price: 8, desc: "Sourced from recycled PET drink bottles. Slightly translucent finish with a smooth feel.", co2: "75% less CO2 vs virgin plastic", icon: "♻",
    pbr: { metalness: 0.02, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.15 } },
  { id: "biopla", name: "Bio-PLA", tag: "Plant-based", price: 15, desc: "Derived from cornstarch and sugarcane. Fully biodegradable and compostable.", co2: "68% less CO2 vs virgin plastic", icon: "☘",
    pbr: { metalness: 0.0, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.08 } },
];

const LENS_TYPES = [
  { id: "clear", name: "Clear", price: 0, desc: "Standard optical lens. Scratch-resistant polycarbonate.",
    tint: { color: 0xeeeeff, transmission: 0.95, opacity: 0.15 } },
  { id: "bluelight", name: "Blue Light Filter", price: 12, desc: "Blocks 40% of blue light. Reduces eye strain from screens.",
    tint: { color: 0xffe8a0, transmission: 0.88, opacity: 0.2 } },
  { id: "polarised", name: "Polarised", price: 20, desc: "Reduces glare from water and roads. UV400 protection.",
    tint: { color: 0x556655, transmission: 0.6, opacity: 0.55 } },
  { id: "tinted", name: "Gradient Tint", price: 15, desc: "Fashion-forward gradient tint. Darker at top, clear at bottom.",
    tint: { color: 0x665566, transmission: 0.7, opacity: 0.45 } },
];

const SIZES = [
  { id: "sm", name: "Small", fit: "Narrow face", width: "126mm" },
  { id: "md", name: "Medium", fit: "Average face", width: "134mm" },
  { id: "lg", name: "Large", fit: "Wide face", width: "142mm" },
];

/* ═══════════════════════════════════════════════════════════
   PART LABELS
   ═══════════════════════════════════════════════════════════ */
const PART_INFO = {
  "left-rim": { label: "Frame Rim", detail: "3D printed, 0.8mm" }, "right-rim": { label: "Frame Rim", detail: "3D printed, 0.8mm" },
  "left-lens": { label: "Lens", detail: "Polycarbonate" }, "right-lens": { label: "Lens", detail: "Polycarbonate" },
  "bridge": { label: "Bridge", detail: "Ergonomic arch" }, "bridge-upper": { label: "Upper Bridge", detail: "Reinforced" }, "bridge-lower": { label: "Lower Bridge", detail: "Flex support" },
  "left-temple": { label: "Temple Arm", detail: "Memory flex" }, "right-temple": { label: "Temple Arm", detail: "Memory flex" },
  "left-hinge": { label: "Spring Hinge", detail: "5-barrel" }, "right-hinge": { label: "Spring Hinge", detail: "5-barrel" },
  "left-pad": { label: "Nose Pad", detail: "Silicone" }, "right-pad": { label: "Nose Pad", detail: "Silicone" },
  "top-bar": { label: "Top Bar", detail: "Structural" },
};
const EXPLODE_DIR = {
  "left-rim": new THREE.Vector3(-0.6,0.1,0.3), "right-rim": new THREE.Vector3(0.6,0.1,0.3),
  "left-lens": new THREE.Vector3(-0.5,0,0.8), "right-lens": new THREE.Vector3(0.5,0,0.8),
  "bridge": new THREE.Vector3(0,0.5,0.2), "bridge-upper": new THREE.Vector3(0,0.55,0.2), "bridge-lower": new THREE.Vector3(0,0.35,0.2),
  "left-temple": new THREE.Vector3(-0.5,-0.1,-0.7), "right-temple": new THREE.Vector3(0.5,-0.1,-0.7),
  "left-hinge": new THREE.Vector3(-0.8,0.3,-0.1), "right-hinge": new THREE.Vector3(0.8,0.3,-0.1),
  "left-pad": new THREE.Vector3(-0.2,-0.7,0.4), "right-pad": new THREE.Vector3(0.2,-0.7,0.4),
  "top-bar": new THREE.Vector3(0,0.6,0.15),
};
const LABEL_PARTS = ["right-lens","bridge","right-temple","right-hinge","right-pad"];
const LABEL_PARTS_W = ["right-lens","bridge","right-temple","right-hinge","right-pad","top-bar"];

/* ═══════════════════════════════════════════════════════════
   FRAMES
   ═══════════════════════════════════════════════════════════ */
const FRAMES = [
  { id:"aviator", name:"Aviator Classic", category:"Sunglasses", basePrice:12, tagline:"Born to fly", labelParts:LABEL_PARTS,
    dimensions:{lens:"58mm",bridge:"14mm",temple:"140mm",height:"50mm"},
    description:"Teardrop silhouette with double bridge. Iconic, lightweight, everyday ready.",
    colors:[
      {name:"Charcoal",frame:0x3a3a3a,lens:0x556b2f,accent:0x777777,bg:["#0f1114","#1a1d23","#12141a"],particle:"#666"},
      {name:"Sand",frame:0xc8a84e,lens:0x5a4a2a,accent:0xd4af37,bg:["#1a1508","#2a2010","#1e1a0c"],particle:"#c8a84e"},
      {name:"Blush",frame:0xb76e79,lens:0x6b4a52,accent:0xd4a0a0,bg:["#1a1015","#2a1520","#1e1018"],particle:"#d4a0a0"},
    ], build:buildAviator },
  { id:"wayfarer", name:"Wayfarer Bold", category:"Everyday", basePrice:10, tagline:"Unapologetically bold", labelParts:LABEL_PARTS_W,
    dimensions:{lens:"54mm",bridge:"18mm",temple:"145mm",height:"42mm"},
    description:"Bold frame with slightly oversized fit. The all-rounder.",
    colors:[
      {name:"Matte Black",frame:0x1a1a1a,lens:0x333344,accent:0x444444,bg:["#08080a","#141418","#0c0c10"],particle:"#444"},
      {name:"Tortoise",frame:0x8b5e3c,lens:0x5a4530,accent:0xa0724a,bg:["#1a1008","#2a1d10","#1e140c"],particle:"#a0724a"},
      {name:"Navy",frame:0x1a2744,lens:0x334466,accent:0x3a5580,bg:["#080c14","#101828","#0c1420"],particle:"#3a5580"},
    ], build:buildWayfarer },
  { id:"round", name:"Round Wire", category:"Optical", basePrice:14, tagline:"Less is everything", labelParts:LABEL_PARTS,
    dimensions:{lens:"49mm",bridge:"20mm",temple:"135mm",height:"49mm"},
    description:"Minimalist round frame. Adjustable nose pads, all-day comfort.",
    colors:[
      {name:"Silver",frame:0xc0c0c0,lens:0x99bbdd,accent:0xe0e0e0,bg:["#0e1018","#181c28","#121620"],particle:"#c0c0c0"},
      {name:"Black",frame:0x222222,lens:0x445566,accent:0x555555,bg:["#0a0a0c","#141416","#0e0e12"],particle:"#555"},
      {name:"Copper",frame:0xb87333,lens:0x88775a,accent:0xcc8844,bg:["#1a1208","#2a1e10","#1e160c"],particle:"#cc8844"},
    ], build:buildRound },
  { id:"cat-eye", name:"Cat-Eye Luxe", category:"Statement", basePrice:14, tagline:"Lead, never follow", labelParts:LABEL_PARTS,
    dimensions:{lens:"55mm",bridge:"16mm",temple:"138mm",height:"46mm"},
    description:"Dramatic upswept corners. Bold silhouette, hand-finished.",
    colors:[
      {name:"Burgundy",frame:0x6b2040,lens:0x553344,accent:0x8a3050,bg:["#14080e","#221018","#1a0c14"],particle:"#8a3050"},
      {name:"Ivory",frame:0xd4c8b0,lens:0x998877,accent:0xe8dcc0,bg:["#18160e","#28241a","#201c14"],particle:"#e8dcc0"},
      {name:"Emerald",frame:0x1a5c3a,lens:0x2a4a3a,accent:0x2a7a50,bg:["#081410","#102a1c","#0c2018"],particle:"#2a7a50"},
    ], build:buildCatEye },
];

/* ═══════════════════════════════════════════════════════════
   GEOMETRY BUILDERS
   ═══════════════════════════════════════════════════════════ */
function makeMaterials(color, matPbr) {
  const p = matPbr || { metalness:0.6, roughness:0.28, clearcoat:1, clearcoatRoughness:0.1 };
  return {
    frame: new THREE.MeshPhysicalMaterial({ color:color.frame, ...p, side:THREE.DoubleSide }),
    lens: new THREE.MeshPhysicalMaterial({ color:color.lens, metalness:0, roughness:0.05, transmission:0.8, thickness:0.3, ior:1.5, transparent:true, opacity:0.45, side:THREE.DoubleSide }),
    hinge: new THREE.MeshPhysicalMaterial({ color:color.accent, metalness:0.9, roughness:0.12, clearcoat:0.5, side:THREE.DoubleSide }),
  };
}
function tag(m,n){ m.userData.partName=n; return m; }
function addTemples(g,mat,xs,yS=0){
  xs.forEach(({x,sign})=>{const c=new THREE.CatmullRomCurve3([new THREE.Vector3(x,yS,0),new THREE.Vector3(x+sign*0.04,yS,-0.3),new THREE.Vector3(x+sign*0.04,yS-0.04,-0.9),new THREE.Vector3(x+sign*0.02,yS-0.14,-1.05)]);const m=new THREE.Mesh(new THREE.TubeGeometry(c,32,0.02,8,false),mat);m.castShadow=true;tag(m,x<0?"left-temple":"right-temple");g.add(m);});
}
function addHinges(g,mat,ps){const geo=new THREE.CylinderGeometry(0.028,0.028,0.055,12);ps.forEach(([x,y],i)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,-0.01);m.rotation.z=Math.PI/2;m.castShadow=true;tag(m,i===0?"left-hinge":"right-hinge");g.add(m);});}
function addNosePads(g,mat,ps){const geo=new THREE.SphereGeometry(0.025,12,12);ps.forEach(([x,y,z],i)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.scale.set(1,1.3,0.6);tag(m,i===0?"left-pad":"right-pad");g.add(m);});}

function buildAviator(color,matPbr){
  const g=new THREE.Group(),m=makeMaterials(color,matPbr);
  const s=new THREE.Shape();s.moveTo(0,0.38);s.quadraticCurveTo(0.42,0.38,0.44,0);s.quadraticCurveTo(0.42,-0.42,0,-0.44);s.quadraticCurveTo(-0.42,-0.42,-0.44,0);s.quadraticCurveTo(-0.42,0.38,0,0.38);
  const pts=s.getPoints(64),rG=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(p.x,p.y,0)),true),64,0.03,8,true),dG=new THREE.ShapeGeometry(s,64);
  [-0.54,0.54].forEach((x,i)=>{const r=tag(new THREE.Mesh(rG,m.frame),i===0?"left-rim":"right-rim");r.position.x=x;r.castShadow=true;g.add(r);const d=tag(new THREE.Mesh(dG,m.lens),i===0?"left-lens":"right-lens");d.position.set(x,0,0.005);g.add(d);});
  [0.08,-0.02].forEach((y,i)=>{const c=new THREE.CatmullRomCurve3([new THREE.Vector3(-0.12,y,0),new THREE.Vector3(0,y+0.04,0.02),new THREE.Vector3(0.12,y,0)]);g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(c,16,0.018,8,false),m.frame),i===0?"bridge-upper":"bridge-lower"));});
  addTemples(g,m.frame,[{x:-0.96,sign:-1},{x:0.96,sign:1}]);addHinges(g,m.hinge,[[-0.96,0],[0.96,0]]);addNosePads(g,m.hinge,[[-0.16,-0.28,0.08],[0.16,-0.28,0.08]]);return g;
}
function buildWayfarer(color,matPbr){
  const g=new THREE.Group(),m=makeMaterials(color,matPbr);m.frame.metalness=Math.min(m.frame.metalness,0.1);
  const s=new THREE.Shape();s.moveTo(-0.38,0.24);s.lineTo(0.4,0.28);s.quadraticCurveTo(0.44,0,0.38,-0.24);s.lineTo(-0.36,-0.22);s.quadraticCurveTo(-0.42,0,-0.38,0.24);
  const pts=s.getPoints(64),rG=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(p.x,p.y,0)),true),64,0.04,8,true),dG=new THREE.ShapeGeometry(s,64);
  const tb=new THREE.Shape();tb.moveTo(-1.02,0.22);tb.lineTo(1.02,0.22);tb.lineTo(1.02,0.36);tb.quadraticCurveTo(0,0.40,-1.02,0.36);tb.lineTo(-1.02,0.22);
  const t=tag(new THREE.Mesh(new THREE.ExtrudeGeometry(tb,{depth:0.06,bevelEnabled:true,bevelThickness:0.01,bevelSize:0.01,bevelSegments:3}),m.frame),"top-bar");t.position.z=-0.03;t.castShadow=true;g.add(t);
  [-0.52,0.52].forEach((x,i)=>{const r=tag(new THREE.Mesh(rG,m.frame),i===0?"left-rim":"right-rim");r.position.x=x;r.castShadow=true;g.add(r);const d=tag(new THREE.Mesh(dG,m.lens),i===0?"left-lens":"right-lens");d.position.set(x,0,0.005);g.add(d);});
  const bc=new THREE.CatmullRomCurve3([new THREE.Vector3(-0.14,0.04,0),new THREE.Vector3(0,0.10,0.02),new THREE.Vector3(0.14,0.04,0)]);g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc,16,0.028,8,false),m.frame),"bridge"));
  addTemples(g,m.frame,[{x:-0.94,sign:-1},{x:0.94,sign:1}]);addHinges(g,m.hinge,[[-0.94,0.05],[0.94,0.05]]);addNosePads(g,m.hinge,[[-0.16,-0.18,0.08],[0.16,-0.18,0.08]]);return g;
}
function buildRound(color,matPbr){
  const g=new THREE.Group(),m=makeMaterials(color,matPbr);const rG=new THREE.TorusGeometry(0.38,0.022,16,64),dG=new THREE.CircleGeometry(0.38,64);
  [-0.48,0.48].forEach((x,i)=>{const r=tag(new THREE.Mesh(rG,m.frame),i===0?"left-rim":"right-rim");r.position.x=x;r.castShadow=true;g.add(r);const d=tag(new THREE.Mesh(dG,m.lens),i===0?"left-lens":"right-lens");d.position.set(x,0,0.005);g.add(d);});
  const bc=new THREE.CatmullRomCurve3([new THREE.Vector3(-0.10,0.06,0),new THREE.Vector3(-0.04,0.14,0.03),new THREE.Vector3(0.04,0.14,0.03),new THREE.Vector3(0.10,0.06,0)]);g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc,20,0.018,8,false),m.frame),"bridge"));
  addTemples(g,m.frame,[{x:-0.86,sign:-1},{x:0.86,sign:1}]);addHinges(g,m.hinge,[[-0.86,0],[0.86,0]]);addNosePads(g,m.hinge,[[-0.14,-0.22,0.08],[0.14,-0.22,0.08]]);return g;
}
function buildCatEye(color,matPbr){
  const g=new THREE.Group(),m=makeMaterials(color,matPbr);
  const s=new THREE.Shape();s.moveTo(-0.36,0.18);s.quadraticCurveTo(-0.10,0.30,0.20,0.34);s.quadraticCurveTo(0.46,0.30,0.44,0.08);s.quadraticCurveTo(0.42,-0.22,0.10,-0.26);s.quadraticCurveTo(-0.24,-0.26,-0.38,-0.10);s.quadraticCurveTo(-0.42,0.04,-0.36,0.18);
  const pts=s.getPoints(64),rG=new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(p.x,p.y,0)),true),64,0.035,8,true),dG=new THREE.ShapeGeometry(s,64);
  [-0.52,0.52].forEach((x,i)=>{const r=tag(new THREE.Mesh(rG,m.frame),i===0?"left-rim":"right-rim");r.position.x=x;if(i===0)r.scale.x=-1;r.castShadow=true;g.add(r);const d=tag(new THREE.Mesh(dG,m.lens),i===0?"left-lens":"right-lens");d.position.set(x,0,0.005);if(i===0)d.scale.x=-1;g.add(d);});
  const bc=new THREE.CatmullRomCurve3([new THREE.Vector3(-0.14,0.10,0),new THREE.Vector3(0,0.16,0.02),new THREE.Vector3(0.14,0.10,0)]);g.add(tag(new THREE.Mesh(new THREE.TubeGeometry(bc,16,0.025,8,false),m.frame),"bridge"));
  addTemples(g,m.frame,[{x:-0.92,sign:-1},{x:0.92,sign:1}],0.12);addHinges(g,m.hinge,[[-0.92,0.12],[0.92,0.12]]);addNosePads(g,m.hinge,[[-0.16,-0.16,0.08],[0.16,-0.16,0.08]]);return g;
}

/* ═══════════════════════════════════════════════════════════
   PARTICLES
   ═══════════════════════════════════════════════════════════ */
function useParticles(ref,c){const cr=useRef(c);cr.current=c;useEffect(()=>{const cv=ref.current;if(!cv)return;const ctx=cv.getContext("2d");let w,h;const rs=()=>{w=cv.width=window.innerWidth;h=cv.height=window.innerHeight};rs();window.addEventListener("resize",rs);const P=[];for(let i=0;i<50;i++)P.push({x:Math.random()*2000,y:Math.random()*2000,vx:(Math.random()-0.5)*0.3,vy:-Math.random()*0.35-0.1,r:Math.random()*2.5+0.5,a:Math.random()*0.4+0.08,p:Math.random()*Math.PI*2});let raf;const draw=()=>{raf=requestAnimationFrame(draw);ctx.clearRect(0,0,w,h);P.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.p+=0.015;if(p.y<-10){p.y=h+10;p.x=Math.random()*w;}if(p.x<-10)p.x=w+10;if(p.x>w+10)p.x=-10;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=cr.current;ctx.globalAlpha=p.a*(0.5+0.5*Math.sin(p.p));ctx.fill();});ctx.globalAlpha=1;};draw();return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",rs);};},[ref]);}

/* ═══════════════════════════════════════════════════════════
   STEP INDICATOR
   ═══════════════════════════════════════════════════════════ */
const STEPS = ["Frame","Material","Lens","Colour","Size","Summary"];

/* step names for reference */

/* ═══════════════════════════════════════════════════════════
   OPTION CARD (reusable)
   ═══════════════════════════════════════════════════════════ */
function OptCard({ selected, onClick, children, style = {} }) {
  return (
    <button className="gv-frame-card" onClick={onClick} style={{
      padding:"14px 16px", borderRadius:12, cursor:"pointer", textAlign:"left", width:"100%",
      display:"flex", flexDirection:"column", gap:4, transition:"all 0.35s cubic-bezier(0.23,1,0.32,1)",
      border: selected ? "1px solid rgba(255,255,255,0.45)" : "1px solid rgba(255,255,255,0.06)",
      background: selected ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.02)", ...style,
    }}>
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */
export default function GlassesViewer() {
  const mountRef = useRef(null);
  const labelsRef = useRef(null);
  const sceneRef = useRef({});
  const particleCanvasRef = useRef(null);

  /* configurator state */
  const [step, setStep] = useState(0);
  const [frameIdx, setFrameIdx] = useState(0);
  const [matIdx, setMatIdx] = useState(0);
  const [lensIdx, setLensIdx] = useState(0);
  const [colorIdx, setColorIdx] = useState(0);
  const [sizeIdx, setSizeIdx] = useState(1);

  /* UI state */
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState("configurator");
  const [loaded, setLoaded] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [introPlayed, setIntroPlayed] = useState(false);
  const [exploded, setExploded] = useState(false);
  const [labelPositions, setLabelPositions] = useState([]);

  const frame = FRAMES[frameIdx];
  const color = frame.colors[colorIdx];
  const material = MATERIALS[matIdx];
  const lens = LENS_TYPES[lensIdx];
  const size = SIZES[sizeIdx];

  const totalPrice = useMemo(() => frame.basePrice + material.price + lens.price, [frame, material, lens]);

  useParticles(particleCanvasRef, color.particle);

  /* ── build glasses ── */
  const buildGlasses = useCallback((fIdx, cIdx, mIdx, animate = true) => {
    const { scene, state } = sceneRef.current; if (!scene) return;
    const oldG = sceneRef.current.glasses;
    const f = FRAMES[fIdx], c = f.colors[cIdx], mt = MATERIALS[mIdx];
    const glasses = f.build(c, mt.pbr);
    glasses.rotation.set(deg(8), deg(-25), 0);
    if (animate) glasses.scale.setScalar(0.01);
    scene.add(glasses);
    sceneRef.current.glasses = glasses;
    if (state) { state.targetRotX = deg(8); state.targetRotY = deg(-25); }
    if (animate) {
      let t = 0;
      const swap = setInterval(() => {
        t += 0.04;
        if (oldG) { const s = Math.max(0, 1 - t * 2.5); oldG.scale.setScalar(s); oldG.rotation.y += 0.04; if (s <= 0) { scene.remove(oldG); oldG.traverse(ch => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); }); } }
        const sIn = Math.min(1, Math.max(0, (t - 0.2) * 2)); glasses.scale.setScalar(1 - Math.pow(1 - sIn, 3));
        if (t >= 1) { clearInterval(swap); setTransitioning(false); glasses.scale.setScalar(1); }
      }, 16);
    } else {
      if (oldG) { scene.remove(oldG); oldG.traverse(ch => { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); }); }
    }
  }, []);

  /* ── apply material/colour/lens changes in-place ── */
  const applyMaterials = useCallback(() => {
    const glasses = sceneRef.current.glasses; if (!glasses) return;
    const c = FRAMES[frameIdx].colors[colorIdx];
    const mt = MATERIALS[matIdx];
    const lt = LENS_TYPES[lensIdx];
    glasses.traverse(child => {
      if (!child.isMesh) return;
      const name = child.userData.partName || "";
      if (name.includes("lens")) {
        child.material.color.setHex(lt.tint.color);
        child.material.transmission = lt.tint.transmission;
        child.material.opacity = lt.tint.opacity;
      } else if (child.material.metalness > 0.8) {
        child.material.color.setHex(c.accent);
      } else {
        child.material.color.setHex(c.frame);
        child.material.metalness = mt.pbr.metalness;
        child.material.roughness = mt.pbr.roughness;
        child.material.clearcoat = mt.pbr.clearcoat;
        child.material.clearcoatRoughness = mt.pbr.clearcoatRoughness;
      }
    });
  }, [frameIdx, colorIdx, matIdx, lensIdx]);

  /* ── exploded view ── */
  useEffect(() => {
    const glasses = sceneRef.current.glasses; const camera = sceneRef.current.camera;
    if (!glasses || !camera) return;
    const targetZoom = exploded ? 4.2 : 2.8;
    let t = 0;
    const id = setInterval(() => {
      t += 0.04; if (t > 1) { clearInterval(id); t = 1; }
      const ease = 1 - Math.pow(1 - t, 3);
      const progress = exploded ? ease : 1 - ease;
      const currentTarget = exploded ? targetZoom : 2.8;
      const currentFrom = exploded ? 2.8 : 4.2;
      camera.position.z = lerp(currentFrom, currentTarget, ease);
      glasses.children.forEach(child => {
        const name = child.userData.partName;
        if (!child._origPos) child._origPos = child.position.clone();
        const dir = EXPLODE_DIR[name] || new THREE.Vector3(0, 0, 0);
        child.position.lerpVectors(child._origPos, child._origPos.clone().add(dir.clone().multiplyScalar(0.6)), progress);
      });
    }, 16);
    return () => clearInterval(id);
  }, [exploded]);

  /* ── label projection ── */
  useEffect(() => {
    if (!exploded) { setLabelPositions([]); return; }
    const update = () => {
      const { glasses, camera } = sceneRef.current; const mount = mountRef.current;
      if (!glasses || !camera || !mount) return;
      const rect = mount.getBoundingClientRect(); const labels = [];
      const activeParts = FRAMES[frameIdx].labelParts;
      glasses.children.forEach(child => {
        const name = child.userData.partName;
        if (!name || !activeParts.includes(name)) return;
        const info = PART_INFO[name]; if (!info) return;
        const wp = new THREE.Vector3(); child.getWorldPosition(wp);
        const ndc = wp.clone().project(camera);
        const sx = (ndc.x * 0.5 + 0.5) * rect.width;
        const sy = (-ndc.y * 0.5 + 0.5) * rect.height;
        if (ndc.z > 0 && ndc.z < 1) labels.push({ name, x: sx, y: sy, label: info.label, detail: info.detail });
      });
      setLabelPositions(labels);
    };
    const id = setInterval(update, 50);
    return () => clearInterval(id);
  }, [exploded, frameIdx]);

  /* ── Three.js init ── */
  useEffect(() => {
    const mount = mountRef.current; if (!mount) return;
    const W = mount.clientWidth, H = mount.clientHeight;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(W, H);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
    mount.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100); camera.position.set(0, 0.15, 4.5);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(3, 4, 5); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
    scene.add(new THREE.DirectionalLight(0x8888ff, 0.5).translateX(-4).translateY(2).translateZ(3));
    scene.add(new THREE.DirectionalLight(0xffffff, 0.9).translateY(3).translateZ(-4));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.55; ground.receiveShadow = true; scene.add(ground);
    const state = { isDragging: false, prevX: 0, prevY: 0, velX: 0, velY: 0, targetRotX: deg(8), targetRotY: deg(-25), mouseNX: 0, mouseNY: 0, introT: 0 };
    sceneRef.current = { renderer, scene, camera, state, mount };
    buildGlasses(0, 0, 0, false);
    setTimeout(() => { setLoaded(true); setIntroPlayed(true); }, 100);

    const canvas = renderer.domElement;
    const onDown = e => { state.isDragging = true; state.prevX = e.clientX; state.prevY = e.clientY; };
    const onMove = e => { const rect = mount.getBoundingClientRect(); state.mouseNX = ((e.clientX - rect.left) / rect.width) * 2 - 1; state.mouseNY = ((e.clientY - rect.top) / rect.height) * 2 - 1; if (!state.isDragging) return; const dx = e.clientX - state.prevX, dy = e.clientY - state.prevY; state.prevX = e.clientX; state.prevY = e.clientY; state.velX = dx * 0.006; state.velY = dy * 0.006; state.targetRotY += dx * 0.006; state.targetRotX += dy * 0.006; };
    const onUp = () => { state.isDragging = false; };
    const onWheel = e => { e.preventDefault(); camera.position.z = Math.max(1.5, Math.min(6, camera.position.z + e.deltaY * 0.003)); };
    canvas.addEventListener("pointerdown", onDown); window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp); canvas.addEventListener("wheel", onWheel, { passive: false });
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const glasses = sceneRef.current.glasses; if (!glasses) return;
      if (state.introT < 1) { state.introT += 0.012; camera.position.z = lerp(4.5, 2.8, 1 - Math.pow(1 - Math.min(state.introT, 1), 4)); }
      if (!state.isDragging) { state.velX *= 0.92; state.velY *= 0.92; state.targetRotY += state.velX; state.targetRotX += state.velY; }
      state.targetRotY += 0.003;
      glasses.rotation.y = lerp(glasses.rotation.y, state.targetRotY, 0.12);
      glasses.rotation.x = lerp(glasses.rotation.x, state.targetRotX, 0.12);
      camera.position.x = lerp(camera.position.x, state.mouseNX * 0.1, 0.05);
      camera.position.y = lerp(camera.position.y, 0.15 - state.mouseNY * 0.06, 0.05);
      camera.lookAt(0, 0, 0); renderer.render(scene, camera);
    };
    animate();
    const onResize = () => { const w = mount.clientWidth, h = mount.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener("pointerdown", onDown); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); canvas.removeEventListener("wheel", onWheel); window.removeEventListener("resize", onResize); if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement); renderer.dispose(); };
  }, [buildGlasses]);

  /* ── reactivity: frame change = animated rebuild, everything else = instant ── */
  const prevFrameRef = useRef(0);
  useEffect(() => {
    if (!sceneRef.current.scene || !introPlayed) return;
    if (frameIdx !== prevFrameRef.current) {
      if (!transitioning) { setTransitioning(true); setExploded(false); buildGlasses(frameIdx, colorIdx, matIdx, true); }
    } else { applyMaterials(); }
    prevFrameRef.current = frameIdx;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIdx, colorIdx, matIdx, lensIdx]);

  /* ── inject CSS ── */
  useEffect(() => {
    const id = "gv-styles"; if (document.getElementById(id)) return;
    const s = document.createElement("style"); s.id = id;
    s.textContent = `
      @keyframes gvFadeUp { from { opacity:0; transform:translateY(24px) } to { opacity:1; transform:translateY(0) } }
      @keyframes gvFadeIn { from { opacity:0 } to { opacity:1 } }
      @keyframes gvSlideIn { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
      @keyframes gvShine { 0% { left:-100% } 100% { left:200% } }
      @keyframes gvSpin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      @keyframes gvLabelIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
      .gv-nav-links { display: flex; gap: 32px; }
      .gv-hamburger { display: none !important; }
      .gv-main { flex-direction: row !important; }
      .gv-cta { position:relative; overflow:hidden; }
      .gv-cta::after { content:''; position:absolute; top:0; left:-100%; width:50%; height:100%; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent); animation: gvShine 3s ease-in-out infinite; }
      .gv-cta:hover { background: #fff !important; transform: translateY(-2px); box-shadow: 0 12px 40px rgba(255,255,255,0.2); }
      .gv-frame-card { transition: all 0.35s cubic-bezier(0.23,1,0.32,1) !important; }
      .gv-frame-card:hover { border-color: rgba(255,255,255,0.3) !important; transform: translateY(-2px); background: rgba(255,255,255,0.06) !important; }
      .gv-swatch { transition: all 0.35s cubic-bezier(0.23,1,0.32,1) !important; }
      .gv-swatch:hover { transform: scale(1.3) !important; }
      .gv-explode { transition: all 0.3s !important; }
      .gv-explode:hover { background: rgba(255,255,255,0.12) !important; }
      .gv-nav-link { transition: all 0.3s !important; }
      .gv-nav-link:hover { opacity: 1 !important; }
      .gv-label-line { stroke-dasharray:200; stroke-dashoffset:200; animation: gvDrawLine 0.6s ease forwards; }
      @keyframes gvDrawLine { to { stroke-dashoffset: 0 } }
      .gv-next:hover { background: #fff !important; color: #000 !important; }
      .gv-back:hover { background: rgba(255,255,255,0.1) !important; }
      @media (max-width: 840px) { .gv-nav-links { display: none !important; } .gv-hamburger { display: flex !important; } .gv-main { flex-direction: column !important; } }
    `;
    document.head.appendChild(s);
  }, []);

  const bg = color.bg;
  const nextStep = () => setStep(Math.min(step + 1, STEPS.length - 1));
  const prevStep = () => setStep(Math.max(step - 1, 0));

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */
  return (
    <div style={{ width: "100%", minHeight: "100vh", background: `linear-gradient(135deg, ${bg[0]} 0%, ${bg[1]} 50%, ${bg[2]} 100%)`, display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", color: "#fff", transition: "background 1s cubic-bezier(0.4,0,0.2,1)", overflowX: "hidden", position: "relative" }}>
      <canvas ref={particleCanvasRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }} />

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(24px) saturate(1.8)", borderBottom: "1px solid rgba(255,255,255,0.06)", animation: introPlayed ? "gvFadeIn 0.8s ease both" : "none" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22, opacity: 0.9 }}>◈</span>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 600, letterSpacing: 4 }}>OPTIQ</span>
            <span style={{ fontSize: 9, opacity: 0.3, letterSpacing: 2, textTransform: "uppercase", marginLeft: 8, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(255,255,255,0.1)" }}>Configurator</span>
          </div>
          <div className="gv-nav-links">
            {[
              { label: "Configurator", action: () => { setPage("configurator"); setStep(0); }, active: page === "configurator" },
              { label: "AI Fit Scanner", action: () => { setPage("scanner"); window.scrollTo({ top: 0, behavior: "smooth" }); }, active: page === "scanner" },
              { label: "Our Impact", action: () => { setPage("impact"); window.scrollTo({ top: 0, behavior: "smooth" }); }, active: page === "impact" },
              { label: "How It Works", action: null, soon: true },
            ].map(item => (
              <button key={item.label} className="gv-nav-link" onClick={item.action || undefined}
                style={{ background: "none", border: "none", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: 1.5, textTransform: "uppercase", cursor: item.action ? "pointer" : "default", padding: "4px 0", opacity: item.active ? 1 : 0.3, borderBottom: item.active ? "1px solid rgba(255,255,255,0.6)" : "1px solid transparent", display: "flex", alignItems: "center", gap: 6 }}>
                {item.label}
                {item.soon && <span style={{ fontSize: 7, padding: "1px 5px", borderRadius: 3, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", letterSpacing: 1, opacity: 0.6 }}>SOON</span>}
              </button>
            ))}
          </div>
          <button className="gv-hamburger" onClick={() => setMenuOpen(!menuOpen)} style={{ flexDirection: "column", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 8 }}>
            {[0,1,2].map(i => <span key={i} style={{ width: 22, height: 1.5, background: "#fff", borderRadius: 2, transition: "all 0.3s", display: "block", ...(i === 0 && menuOpen ? { transform: "rotate(45deg) translate(4px,4px)" } : i === 1 && menuOpen ? { opacity: 0 } : i === 2 && menuOpen ? { transform: "rotate(-45deg) translate(4px,-4px)" } : {}) }} />)}
          </button>
        </div>
        {menuOpen && (
          <div style={{ display: "flex", flexDirection: "column", padding: "8px 24px 16px", gap: 4, borderTop: "1px solid rgba(255,255,255,0.06)", animation: "gvFadeUp 0.3s ease both" }}>
            <button onClick={() => { setPage("configurator"); setStep(0); setMenuOpen(false); }}
              style={{ background: "none", border: "none", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 14, padding: "10px 0", textAlign: "left", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", opacity: page === "configurator" ? 1 : 0.5 }}>Configurator</button>
            <button onClick={() => { setPage("scanner"); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={{ background: "none", border: "none", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 14, padding: "10px 0", textAlign: "left", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", opacity: page === "scanner" ? 1 : 0.5 }}>AI Fit Scanner</button>
            <button onClick={() => { setPage("impact"); setMenuOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              style={{ background: "none", border: "none", color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 14, padding: "10px 0", textAlign: "left", cursor: "pointer", letterSpacing: 1, textTransform: "uppercase", opacity: page === "impact" ? 1 : 0.5 }}>Our Impact</button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 14, letterSpacing: 1, textTransform: "uppercase", opacity: 0.35 }}>How It Works</span>
              <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", letterSpacing: 1, opacity: 0.4 }}>SOON</span>
            </div>
          </div>
        )}
      </nav>

      {/* MAIN */}
      <div className="gv-main" style={{ flex: 1, maxWidth: 1200, width: "100%", margin: "0 auto", padding: "24px 24px", display: page === "configurator" ? "flex" : "none", gap: 40, alignItems: "flex-start", flexWrap: "wrap", position: "relative", zIndex: 2, boxSizing: "border-box" }}>

        {/* 3D VIEWPORT */}
        <div style={{ flex: "1 1 480px", minWidth: 320, position: "relative" }}>
          <div style={{ position: "relative" }}>
            <div ref={mountRef} style={{ width: "100%", aspectRatio: "4 / 3", borderRadius: 20, overflow: "hidden", cursor: "grab", opacity: loaded ? 1 : 0, transition: "opacity 1.2s cubic-bezier(0.4,0,0.2,1)", boxShadow: "0 0 80px rgba(0,0,0,0.3)" }} />
            {/* labels */}
            {exploded && labelPositions.length > 0 && (
              <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
                {labelPositions.map((lp, i) => {
                  const cx = mountRef.current?.clientWidth / 2 || 300;
                  const cy = mountRef.current?.clientHeight / 2 || 225;
                  const angle = Math.atan2(lp.y - cy, lp.x - cx);
                  const lx = lp.x + Math.cos(angle) * 100;
                  const ly = lp.y + Math.sin(angle) * 100;
                  const ta = lx > cx ? "start" : "end";
                  return (
                    <g key={lp.name} style={{ animation: `gvLabelIn 0.5s ease ${0.1 * i}s both` }}>
                      <line className="gv-label-line" x1={lp.x} y1={lp.y} x2={lx} y2={ly} stroke="rgba(255,255,255,0.4)" strokeWidth="1" style={{ animationDelay: `${0.1 * i}s` }} />
                      <circle cx={lp.x} cy={lp.y} r="3" fill="rgba(255,255,255,0.9)" />
                      <text x={lx + (ta === "start" ? 10 : -10)} y={ly - 6} fill="white" fontSize="11" fontWeight="600" fontFamily="DM Sans" textAnchor={ta} letterSpacing="1" style={{ textTransform: "uppercase" }}>{lp.label}</text>
                      <text x={lx + (ta === "start" ? 10 : -10)} y={ly + 9} fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="DM Sans" textAnchor={ta}>{lp.detail}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
            <button className="gv-explode" onClick={() => setExploded(!exploded)} style={{ background: exploded ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "7px 18px", borderRadius: 8, cursor: "pointer", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>
              {exploded ? "◇ Assemble" : "◈ Explode"}
            </button>
            <button className="gv-explode" onClick={() => { setExploded(false); if (sceneRef.current.state) { sceneRef.current.state.targetRotX = deg(8); sceneRef.current.state.targetRotY = deg(-25); sceneRef.current.camera.position.z = 2.8; } }} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "7px 18px", borderRadius: 8, cursor: "pointer", fontSize: 10, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "'DM Sans', sans-serif" }}>
              ↺ Reset
            </button>
          </div>
          <p style={{ textAlign: "center", fontSize: 10, opacity: 0.2, marginTop: 8, letterSpacing: 1 }}>Drag to rotate · Scroll to zoom</p>

          {/* LIVE PRICE TICKER */}
          <div style={{ marginTop: 20, padding: "16px 20px", borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ margin: 0, fontSize: 10, opacity: 0.35, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>Your Build</p>
              <p style={{ margin: "4px 0 0", fontSize: 13, opacity: 0.6 }}>{frame.name} · {material.name} · {lens.name}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600 }}>${totalPrice}</p>
              <p style={{ margin: 0, fontSize: 10, opacity: 0.3 }}>estimated</p>
            </div>
          </div>
        </div>

        {/* CONFIGURATOR PANEL */}
        <div style={{ flex: "1 1 340px", minWidth: 0, maxWidth: "100%", display: "flex", flexDirection: "column", paddingTop: 4 }}>

          {/* compact step indicator */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, animation: "gvFadeUp 0.4s ease both" }}>
            <span style={{ fontSize: 10, opacity: 0.3, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>
              Step {step + 1} of {STEPS.length}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {STEPS.map((_, i) => (
                <button key={i} onClick={() => setStep(i)} style={{
                  width: i === step ? 20 : 8, height: 8, borderRadius: 4,
                  background: i === step ? "rgba(255,255,255,0.8)" : i < step ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.08)",
                  border: "none", cursor: "pointer", transition: "all 0.4s cubic-bezier(0.23,1,0.32,1)", padding: 0,
                }} />
              ))}
            </div>
          </div>

          <div key={step} style={{ animation: "gvFadeUp 0.35s ease both", flex: 1 }}>

            {/* STEP 0: FRAME */}
            {step === 0 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Choose your frame</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 20px" }}>Each frame is 3D printed from recycled materials to your exact specs.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {FRAMES.map((f, i) => (
                  <OptCard key={f.id} selected={frameIdx === i} onClick={() => { setFrameIdx(i); setColorIdx(0); }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{f.name}</span>
                        <p style={{ margin: "3px 0 0", fontSize: 11, opacity: 0.4 }}>{f.description}</p>
                      </div>
                      <span style={{ fontSize: 14, opacity: 0.5, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", marginLeft: 12 }}>${f.basePrice}</span>
                    </div>
                  </OptCard>
                ))}
              </div>
            </>)}

            {/* STEP 1: MATERIAL */}
            {step === 1 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Pick your material</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 20px" }}>All materials are sourced from post-consumer waste. Zero virgin plastic.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {MATERIALS.map((mt, i) => (
                  <OptCard key={mt.id} selected={matIdx === i} onClick={() => setMatIdx(i)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 16 }}>{mt.icon}</span>
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{mt.name}</span>
                          <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", letterSpacing: 1, textTransform: "uppercase", opacity: 0.5 }}>{mt.tag}</span>
                        </div>
                        <p style={{ margin: "0 0 4px", fontSize: 12, opacity: 0.4, lineHeight: 1.5 }}>{mt.desc}</p>
                        <p style={{ margin: 0, fontSize: 10, opacity: 0.3, color: "#6fcf97" }}>{mt.co2}</p>
                      </div>
                      <span style={{ fontSize: 14, opacity: 0.5, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", marginLeft: 12 }}>{mt.price === 0 ? "included" : `+$${mt.price}`}</span>
                    </div>
                  </OptCard>
                ))}
              </div>
            </>)}

            {/* STEP 2: LENS */}
            {step === 2 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Select your lens</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 20px" }}>All lenses are scratch-resistant polycarbonate with UV protection.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {LENS_TYPES.map((lt, i) => (
                  <OptCard key={lt.id} selected={lensIdx === i} onClick={() => setLensIdx(i)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: hex(lt.tint.color), opacity: 0.4 + (1 - lt.tint.transmission) * 0.6, border: "1px solid rgba(255,255,255,0.15)", flexShrink: 0 }} />
                        <div>
                          <span style={{ fontSize: 15, fontWeight: 500 }}>{lt.name}</span>
                          <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.4 }}>{lt.desc}</p>
                        </div>
                      </div>
                      <span style={{ fontSize: 14, opacity: 0.5, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", marginLeft: 12 }}>{lt.price === 0 ? "included" : `+$${lt.price}`}</span>
                    </div>
                  </OptCard>
                ))}
              </div>
            </>)}

            {/* STEP 3: COLOUR */}
            {step === 3 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Choose your colour</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 20px" }}>Pigment is mixed directly into the recycled filament before printing.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {frame.colors.map((c, i) => (
                  <OptCard key={i} selected={colorIdx === i} onClick={() => setColorIdx(i)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: hex(c.frame), border: "2px solid rgba(255,255,255,0.15)", flexShrink: 0 }} />
                      <div>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{c.name}</span>
                        <p style={{ margin: "2px 0 0", fontSize: 11, opacity: 0.35 }}>No additional cost</p>
                      </div>
                    </div>
                  </OptCard>
                ))}
              </div>
            </>)}

            {/* STEP 4: SIZE */}
            {step === 4 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Select your size</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 8px" }}>3D printing means every pair can be made to measure. Pick your starting point.</p>
              <p style={{ fontSize: 11, opacity: 0.25, margin: "0 0 20px" }}>In a future update, our AI face scanner will recommend the perfect fit automatically.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {SIZES.map((sz, i) => (
                  <OptCard key={sz.id} selected={sizeIdx === i} onClick={() => setSizeIdx(i)}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>{sz.name}</span>
                        <p style={{ margin: "2px 0 0", fontSize: 12, opacity: 0.4 }}>{sz.fit} · Total width: {sz.width}</p>
                      </div>
                    </div>
                  </OptCard>
                ))}
              </div>
              {/* dimension diagram - matches actual 3D geometry, scales with size */}
              {(() => {
                const sc = [0.88, 1.0, 1.1][sizeIdx];
                const cx = 140, cy = 46;
                const sw = size.width;
                /* mirror helper: takes left-side x, returns right-side x */
                const mx = (x) => cx + (cx - x);

                return (
                  <div style={{ marginTop: 16, padding: "18px 14px 12px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <svg viewBox="0 0 280 110" style={{ width: "100%", height: "auto", opacity: 0.4 }}>
                      <g transform={`translate(${cx},${cy}) scale(${sc}) translate(${-cx},${-cy})`}>

                        {/* AVIATOR - teardrop with double bridge */}
                        {frame.id === "aviator" && (<>
                          <path d={`M72 20 Q105 18 110 46 Q105 78 72 80 Q39 78 34 46 Q39 18 72 20Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <path d={`M${mx(72)} 20 Q${mx(105)} 18 ${mx(110)} 46 Q${mx(105)} 78 ${mx(72)} 80 Q${mx(39)} 78 ${mx(34)} 46 Q${mx(39)} 18 ${mx(72)} 20Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <path d={`M110 37 Q${cx} 28 ${mx(110)} 37`} fill="none" stroke="#fff" strokeWidth="1.2" />
                          <path d={`M110 44 Q${cx} 36 ${mx(110)} 44`} fill="none" stroke="#fff" strokeWidth="0.8" />
                        </>)}

                        {/* WAYFARER - angular trapezoid with thick top bar */}
                        {frame.id === "wayfarer" && (<>
                          <path d={`M36 28 L108 24 Q113 46 108 68 L36 72 Q30 46 36 28Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <path d={`M${mx(36)} 28 L${mx(108)} 24 Q${mx(113)} 46 ${mx(108)} 68 L${mx(36)} 72 Q${mx(30)} 46 ${mx(36)} 28Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <rect x="28" y="20" width="224" height="6" rx="2" fill="rgba(255,255,255,0.3)" stroke="#fff" strokeWidth="0.8" />
                          <path d={`M108 34 Q${cx} 26 ${mx(108)} 34`} fill="none" stroke="#fff" strokeWidth="1.2" />
                        </>)}

                        {/* ROUND - perfect circles */}
                        {frame.id === "round" && (<>
                          <circle cx="72" cy={cy} r="28" fill="none" stroke="#fff" strokeWidth="1.3" />
                          <circle cx={mx(72)} cy={cy} r="28" fill="none" stroke="#fff" strokeWidth="1.3" />
                          <path d={`M100 36 Q110 28 120 30 Q160 28 ${mx(100)} 36`} fill="none" stroke="#fff" strokeWidth="1.2" />
                        </>)}

                        {/* CAT-EYE - dramatic upswept */}
                        {frame.id === "cat-eye" && (<>
                          <path d={`M38 52 Q36 30 52 24 Q72 18 98 20 Q112 26 110 46 Q108 68 78 74 Q50 74 38 52Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <path d={`M${mx(38)} 52 Q${mx(36)} 30 ${mx(52)} 24 Q${mx(72)} 18 ${mx(98)} 20 Q${mx(112)} 26 ${mx(110)} 46 Q${mx(108)} 68 ${mx(78)} 74 Q${mx(50)} 74 ${mx(38)} 52Z`} fill="none" stroke="#fff" strokeWidth="1.4" />
                          <path d={`M110 32 Q${cx} 24 ${mx(110)} 32`} fill="none" stroke="#fff" strokeWidth="1.2" />
                        </>)}

                        {/* temple arms (subtle, all frames) */}
                        <line x1="10" y1={cy} x2="30" y2={cy} stroke="#fff" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" />
                        <line x1={mx(10)} y1={cy} x2={mx(30)} y2={cy} stroke="#fff" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" />

                      </g>

                      {/* measurement lines stay outside the scale group so text doesn't stretch */}
                      {/* lens width */}
                      <line x1="34" y1="92" x2="110" y2="92" stroke="#fff" strokeWidth="0.6" />
                      <line x1="34" y1="89" x2="34" y2="95" stroke="#fff" strokeWidth="0.6" />
                      <line x1="110" y1="89" x2="110" y2="95" stroke="#fff" strokeWidth="0.6" />
                      <text x="72" y="102" fill="#fff" fontSize="8" textAnchor="middle" fontFamily="DM Sans" fontWeight="500">{frame.dimensions.lens}</text>
                      {/* bridge */}
                      <line x1="112" y1="10" x2="168" y2="10" stroke="#fff" strokeWidth="0.6" />
                      <line x1="112" y1="7" x2="112" y2="13" stroke="#fff" strokeWidth="0.6" />
                      <line x1="168" y1="7" x2="168" y2="13" stroke="#fff" strokeWidth="0.6" />
                      <text x="140" y="8" fill="#fff" fontSize="8" textAnchor="middle" fontFamily="DM Sans" fontWeight="500">{frame.dimensions.bridge}</text>
                      {/* total width */}
                      <text x="140" y="110" fill="#fff" fontSize="7" textAnchor="middle" fontFamily="DM Sans" opacity="0.45">total width: {sw}</text>
                    </svg>
                  </div>
                );
              })()}
            </>)}

            {/* STEP 5: SUMMARY */}
            {step === 5 && (<>
              <h2 style={{ fontFamily: "'Playfair Display', serif", fontSize: 26, fontWeight: 500, margin: "0 0 6px" }}>Your custom pair</h2>
              <p style={{ fontSize: 13, opacity: 0.4, margin: "0 0 20px" }}>Review your configuration before ordering.</p>

              <div style={{ display: "flex", flexDirection: "column", gap: 1, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
                {[
                  ["Frame", frame.name, `$${frame.basePrice}`],
                  ["Material", `${material.name} (${material.tag})`, material.price === 0 ? "included" : `+$${material.price}`],
                  ["Lens", lens.name, lens.price === 0 ? "included" : `+$${lens.price}`],
                  ["Colour", color.name, "included"],
                  ["Size", `${size.name} (${size.width})`, "included"],
                ].map(([label, value, price], i) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: i % 2 === 0 ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.02)" }}>
                    <div>
                      <span style={{ fontSize: 10, opacity: 0.35, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600 }}>{label}</span>
                      <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 500 }}>{value}</p>
                    </div>
                    <span style={{ fontSize: 13, opacity: 0.5, fontFamily: "'JetBrains Mono', monospace" }}>{price}</span>
                  </div>
                ))}
              </div>

              {/* impact card */}
              <div style={{ padding: "16px 20px", borderRadius: 12, background: "rgba(111,207,151,0.06)", border: "1px solid rgba(111,207,151,0.15)", marginBottom: 20 }}>
                <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "#6fcf97", letterSpacing: 1, textTransform: "uppercase" }}>Environmental Impact</p>
                <p style={{ margin: 0, fontSize: 13, opacity: 0.6, lineHeight: 1.6 }}>
                  Your pair uses approximately 15g of recycled plastic, diverting ~3 bottle caps from landfill. {material.co2}.
                </p>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderRadius: 12, background: "rgba(255,255,255,0.06)", marginBottom: 20 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Total</span>
                <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 600 }}>${totalPrice}</span>
              </div>

              <button className="gv-cta" style={{ width: "100%", padding: "18px 0", background: "rgba(255,255,255,0.92)", color: "#000", border: "none", borderRadius: 12, fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", cursor: "pointer", transition: "all 0.4s cubic-bezier(0.23,1,0.32,1)" }}>
                Order Custom Pair
              </button>
            </>)}
          </div>

          {/* NAV BUTTONS */}
          <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
            {step > 0 && (
              <button className="gv-back" onClick={prevStep} style={{ flex: 1, padding: "14px 0", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#fff", fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", transition: "all 0.3s" }}>
                Back
              </button>
            )}
            {step < STEPS.length - 1 && (
              <button className="gv-next" onClick={nextStep} style={{ flex: 2, padding: "14px 0", background: "rgba(255,255,255,0.85)", color: "#111", border: "none", borderRadius: 10, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 600, letterSpacing: 1.5, textTransform: "uppercase", cursor: "pointer", transition: "all 0.3s" }}>
                Next: {STEPS[step + 1]}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* IMPACT PAGE */}
      {page === "impact" && (
        <div style={{ position: "relative", zIndex: 2, flex: 1, width: "100%" }}>
          <ImpactPage />
        </div>
      )}

      {/* AI FIT SCANNER */}
      {page === "scanner" && (
        <div style={{ position: "relative", zIndex: 2, flex: 1, width: "100%" }}>
          <FitScanner onApplyFit={(fIdx, sIdx) => {
            setFrameIdx(fIdx);
            setColorIdx(0);
            setSizeIdx(sIdx);
            setStep(5);
            setPage("configurator");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }} />
        </div>
      )}

      <footer style={{ padding: 20, textAlign: "center", fontSize: 10, letterSpacing: 3, opacity: 0.2, textTransform: "uppercase", display: "flex", gap: 16, justifyContent: "center", borderTop: "1px solid rgba(255,255,255,0.03)", marginTop: "auto", position: "relative", zIndex: 2 }}>
        <span>OPTIQ © 2026</span><span>·</span><span>Recycled eyewear, 3D printed for you</span>
      </footer>
    </div>
  );
}