import './style.css';
import { WadParser } from './WadParser.ts';
import { GeometryBuilder } from './GeometryBuilder.ts';
import { BvhBuilder } from './BvhBuilder.ts';
import { TextureAtlasBuilder } from './TextureAtlasBuilder.ts';
import { WebGpuRenderer } from './WebGpuRenderer.ts';

async function init() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <div id="ui">
      <h1>WebGPU Doom Path Tracer</h1>
      <p id="status">Loading DOOM1.WAD...</p>
      <p>Click on the canvas to lock pointer. Use WASD to move.</p>
      
      <div id="paint-ui" style="display: none; background: rgba(0,0,0,0.8); padding: 10px; border-radius: 8px; margin-top: 10px; border: 1px solid #444;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
          <input type="checkbox" id="paintModeToggle">
          <strong style="color: #ffaa00;">Enable Paint Mode</strong>
        </label>
        <div style="margin-top: 10px;">
          <label>Emission Intensity: <span id="intensityVal">5.0</span></label><br>
          <input type="range" id="intensitySlider" min="0" max="20" step="0.5" value="5" style="width: 100%;">
        </div>
      </div>
    </div>
    <div style="position: relative; display: inline-block;">
      <canvas id="glcanvas" width="800" height="600"></canvas>
      <div id="crosshair" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: white; pointer-events: none; font-size: 24px; text-shadow: 0 0 2px black;">+</div>
    </div>
  `;

  try {
    const response = await fetch('/DOOM1.WAD');
    if (!response.ok) throw new Error("Failed to load WAD: " + response.statusText);

    const arrayBuffer = await response.arrayBuffer();
    const wad = new WadParser(arrayBuffer);

    document.querySelector<HTMLParagraphElement>('#status')!.innerText =
      "Loaded WAD with " + wad.header.numlumps + " lumps. Parsing Map...";

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Building Texture Atlas...";
    const mapData = wad.parseMap('E1M1');
    const atlasBuilder = new TextureAtlasBuilder(wad, mapData);
    atlasBuilder.build();

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Extracting Geometry...";
    const geoBuilder = new GeometryBuilder(mapData, atlasBuilder);
    const { triangles, materials } = geoBuilder.build();

    document.querySelector<HTMLParagraphElement>('#status')!.innerText =
      "Building BVH for " + triangles.length + " triangles...";

    const bvhBuilder = new BvhBuilder(triangles);
    const { nodes, orderedTriangles } = bvhBuilder.build();

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Initializing WebGPU...";

    const canvas = document.querySelector<HTMLCanvasElement>('#glcanvas')!;
    const renderer = new WebGpuRenderer(canvas);
    await renderer.init(orderedTriangles, nodes, mapData, materials, atlasBuilder);

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Ready!";
    
    // Setup Paint UI
    document.querySelector<HTMLElement>('#paint-ui')!.style.display = 'block';
    const paintToggle = document.querySelector<HTMLInputElement>('#paintModeToggle')!;
    const intensitySlider = document.querySelector<HTMLInputElement>('#intensitySlider')!;
    const intensityVal = document.querySelector<HTMLElement>('#intensityVal')!;
    const crosshair = document.querySelector<HTMLElement>('#crosshair')!;

    paintToggle.addEventListener('change', () => {
      crosshair.style.display = paintToggle.checked ? 'block' : 'none';
    });
    intensitySlider.addEventListener('input', () => {
      intensityVal.innerText = intensitySlider.value;
    });

    window.addEventListener('mousedown', e => {
      if (document.pointerLockElement === canvas && paintToggle.checked && e.button === 0) {
        renderer.paintSurface(parseFloat(intensitySlider.value));
      }
    });

    // Input handling
    let keys: Record<string, boolean> = {};
    window.addEventListener('keydown', e => keys[e.code] = true);
    window.addEventListener('keyup', e => keys[e.code] = false);

    let mouseDeltaX = 0;
    let mouseDeltaY = 0;
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement === canvas) {
        mouseDeltaX += e.movementX;
        mouseDeltaY += e.movementY;
      }
    });

    const speed = 3;
    const sensitivity = 0.002;

    function frame() {
      let dx = 0;
      let dz = 0;
      if (keys['KeyW']) dz += speed;
      if (keys['KeyS']) dz -= speed;
      if (keys['KeyA']) dx -= speed;
      if (keys['KeyD']) dx += speed;

      renderer.updateCamera(dx, dz, mouseDeltaX * sensitivity, -mouseDeltaY * sensitivity);

      mouseDeltaX = 0;
      mouseDeltaY = 0;

      renderer.render();
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

  } catch (err) {
    console.error(err);
    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Error: " + err;
  }
}

init();
