# OPTIQ - 3D Glasses Viewer

Interactive 3D product viewer for glasses built with React and Three.js. This is the frontend prototype for our glasses showcase, featuring multiple frame styles, colour variants, exploded component views with Apple keynote-style labels, and a full product page UI.

Live dev server: `npm run dev` then open `http://localhost:5173`

---

## What We Have Right Now

### Core Features
- 4 distinct frame styles (Aviator, Wayfarer, Round Wire, Cat-Eye) each with unique geometry
- 3 colour variants per frame that swap instantly without rebuilding the 3D model
- Drag to rotate, scroll to zoom, mouse parallax on camera
- Auto-rotation with inertia when you release a drag
- Cinematic intro zoom when the page first loads
- Animated transitions when switching between frame styles
- Exploded view that separates all components with a smooth camera zoom-out
- Floating SVG labels on each component in exploded mode (leader lines, part names, material specs)
- Floating particle overlay that changes colour to match the selected variant
- Sticky nav with category filtering
- Responsive layout with mobile hamburger menu
- Dimensions tab with measurements and an SVG diagram
- Staggered fade-up animations on all product info text

### Tech Stack
- React (scaffolded with Vite)
- Three.js (vanilla, no R3F wrapper for this prototype)
- Google Fonts (Playfair Display + DM Sans)
- No other dependencies needed beyond `three`

---

## About the 3D Models

**The current models are not loaded from files.** They are procedurally generated using Three.js geometry primitives directly in the code. Each frame style has its own builder function (`buildAviator`, `buildWayfarer`, `buildRound`, `buildCatEye`) that creates the geometry from scratch using shapes like `TorusGeometry`, `TubeGeometry`, `ShapeGeometry`, `CylinderGeometry`, `SphereGeometry`, etc.

This means:
- There are no .glb, .obj, or .fbx files in the project right now
- The shapes are approximations, not production-accurate models
- Colour swapping works by directly changing material properties on the existing meshes
- The exploded view knows about each part because every mesh is tagged with a `userData.partName`

This approach was intentional for the prototype since it keeps the project lightweight (no asset files to manage) and lets us iterate on the UI and interactions without waiting on 3D assets from a modelling team.

---

## How to Add Real .glb Models

When we're ready to move from procedural geometry to actual 3D scanned or modelled glasses, here's the process.

### 1. Prepare the Model

Export from Blender (or whatever DCC tool the 3D team uses) as **glTF 2.0 Binary (.glb)**. This is the standard web format and what every major 3D viewer uses.

Guidelines for the 3D team:
- Keep file size under 5MB per model, ideally under 2MB
- Bake PBR textures (base colour, metallic-roughness, normal map) into the GLB
- Use power-of-two texture dimensions (1024x1024 or 2048x2048)
- Name each mesh/object in Blender clearly: `left-rim`, `right-lens`, `bridge`, `left-temple`, `right-hinge`, `left-pad`, etc. These names are what the code uses for exploded view labels and colour swapping
- Center the model at origin with Y-up orientation
- Scale so the full glasses width is roughly 1 unit

### 2. Add the File to the Project

Drop the .glb file into the `public/models/` folder:

```
glasses-viewer/
  public/
    models/
      aviator-gunmetal.glb
      wayfarer-black.glb
      round-silver.glb
      cat-eye-burgundy.glb
```

### 3. Install the Loader Libraries

We'll need the React Three Fiber ecosystem to load .glb files properly:

```bash
npm install @react-three/fiber @react-three/drei
```

The `useGLTF` hook from drei handles loading, caching, and preloading automatically.

### 4. Update the Code

Replace the procedural builder functions with a loader approach. Instead of:

```js
build: buildAviator
```

You'd have something like:

```js
modelUrl: "/models/aviator-gunmetal.glb"
```

And then load it with:

```js
import { useGLTF } from "@react-three/drei";

const { scene } = useGLTF("/models/aviator-gunmetal.glb");
const glasses = scene.clone();
```

The colour swapping logic stays the same since it just traverses the mesh tree and updates material colours. The exploded view labels also stay the same as long as the mesh names in Blender match the part names in the code.

### 5. Hosting the Assets

For production, don't serve .glb files from the same server as the app. Put them on a CDN:
- **Cloudflare R2** (cheap, fast, no egress fees)
- **AWS S3 + CloudFront**
- **Vercel Blob Storage** (if we stay on Vercel for hosting)

Then point the model URLs to the CDN instead of the local public folder.

---

## Project Structure

```
glasses-viewer/
  public/
    models/              <-- put .glb files here when ready
  src/
    GlassesViewer.jsx    <-- the entire viewer component (single file)
    App.jsx              <-- just imports and renders GlassesViewer
    main.jsx             <-- Vite entry point
  package.json
  vite.config.js
```

Everything lives in one component file right now. When we move to production we should break it up into:
- `components/GlassesScene.jsx` (Three.js canvas and 3D logic)
- `components/ProductPanel.jsx` (product info, tabs, CTA)
- `components/ExplodedLabels.jsx` (SVG label overlay)
- `components/ParticleOverlay.jsx` (floating particles)
- `components/Nav.jsx` (navigation bar)
- `data/frames.js` (frame definitions, colours, dimensions)
- `builders/` folder (one file per frame style if staying procedural)

---

## Running Locally

```bash
cd glasses-viewer
npm install
npm install three
npm run dev
```

Opens at `http://localhost:5173`. Hot reloads on save.

---

## Key Things to Know

**Colour swapping is instant by design.** It doesn't rebuild the model. It just changes the `.color` property on existing materials. This is important for UX since you don't want a loading spinner when someone clicks a colour swatch.

**Frame switching is animated on purpose.** The old model scales down and spins away, the new one scales up. This is intentional since it gives the impression of a premium experience and hides any brief loading time if we switch to real .glb models later.

**The exploded view labels track in real-time.** They project 3D world positions to 2D screen coordinates every 50ms. If you rotate the model while exploded, the labels follow. This works because each mesh has a `userData.partName` that maps to the label data in the `PART_INFO` object at the top of the file.

**The particle overlay is a separate 2D canvas.** It sits on top of everything with `pointer-events: none` so it doesn't interfere with clicks or drags. Colour changes are instant since it just reads from a ref.

---

## What's Next

Some things we could add depending on where the product goes:
- AR try-on using MediaPipe face mesh or Google's model-viewer WebXR
- Side-by-side compare mode for two frames
- Face shape recommendation quiz
- Saved/wishlist functionality
- Real product photography mixed with the 3D view
- Loading actual .glb models from the 3D team
- Performance optimization (instanced geometry, texture atlasing, LOD)

---

## Questions?

If something in the code doesn't make sense or you need help extending it, the main things to search for in GlassesViewer.jsx are:
- `buildAviator` / `buildWayfarer` / `buildRound` / `buildCatEye` for geometry
- `PART_INFO` and `EXPLODE_DIR` for label and explode config
- `makeMaterials` for PBR material setup
- `updateColors` for the instant colour swap logic
- `labelPositions` for the 3D-to-2D projection system