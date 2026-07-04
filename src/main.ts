import './style.css';
import { WadParser } from './WadParser.ts';
import { GeometryBuilder } from './GeometryBuilder.ts';
import { BvhBuilder } from './BvhBuilder.ts';
import { TextureAtlasBuilder } from './TextureAtlasBuilder.ts';
import { WebGpuRenderer } from './WebGpuRenderer.ts';

async function init() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <div id="ui" style="position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.7); padding: 15px; border-radius: 8px; max-width: 350px; color: white;">
      <h2 style="margin-top: 0;">WebGPU Doom Path Tracer</h2>
      <p id="status">Loading DOOM1.WAD...</p>
      <p style="font-size: 0.9em; color: #ccc;">Click on the canvas to lock pointer. Use WASD to move.</p>
      
      <div id="paint-ui" style="display: none; background: rgba(0,0,0,0.8); padding: 10px; border-radius: 8px; margin-top: 10px; border: 1px solid #444;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
          <input type="checkbox" id="paintModeToggle">
          <strong style="color: #ffaa00;">Enable Paint Mode</strong>
        </label>
        <div style="margin-top: 10px;">
          <label>Emission Intensity: <span id="intensityVal">5.0</span></label><br>
          <input type="range" id="intensitySlider" min="0" max="20" step="0.5" value="5" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Emission FWHM (Degrees): <span id="fwhmVal">180</span></label><br>
          <input type="range" id="fwhmSlider" min="1" max="180" step="1" value="180" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Render Scale: <span id="scaleVal">1.0</span></label><br>
          <input type="range" id="scaleSlider" min="0.1" max="1.0" step="0.1" value="1.0" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Ambient Light: <span id="ambientVal">0.05</span></label><br>
          <input type="range" id="ambientSlider" min="0" max="0.5" step="0.01" value="0.05" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Sky Light: <span id="skyVal">1.0</span></label><br>
          <input type="range" id="skySlider" min="0" max="5.0" step="0.1" value="1.0" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Sun Azimuth: <span id="azimuthVal">45</span>°</label><br>
          <input type="range" id="azimuthSlider" min="0" max="360" step="1" value="45" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Sun Elevation: <span id="elevationVal">45</span>°</label><br>
          <input type="range" id="elevationSlider" min="0" max="90" step="1" value="45" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Temporal Smear: <span id="smearVal">0.2</span></label><br>
          <input type="range" id="smearSlider" min="0.01" max="1.0" step="0.01" value="0.2" style="width: 100%;">
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
            <input type="checkbox" id="volumetricToggle">
            <strong>Enable Volumetrics</strong>
          </label>
          <div style="margin-top: 10px;">
            <label>Fog Density: <span id="fogVal">0.002</span></label><br>
            <input type="range" id="fogSlider" min="0.0001" max="0.01" step="0.0001" value="0.002" style="width: 100%;">
          </div>
        </div>
        <div style="margin-top: 10px; border-top: 1px solid #444; padding-top: 10px;">
          <label>Max Bounces: <span id="bounceVal">2</span></label><br>
          <input type="range" id="bounceSlider" min="1" max="8" step="1" value="2" style="width: 100%;">
        </div>
      </div>
    </div>
    <div style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; overflow: hidden; z-index: 1; background: black;">
      <canvas id="glcanvas" style="width: 100%; height: 100%; display: block; object-fit: cover;"></canvas>
      <div id="crosshair" style="display: none; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: white; pointer-events: none; font-size: 24px; text-shadow: 0 0 2px black;">+</div>
    </div>
  `;

  try {
    const response = await fetch(import.meta.env.BASE_URL + 'DOOM1.WAD');
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
    // Set internal resolution to match the physical pixels of the display
    canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    
    const renderer = new WebGpuRenderer(canvas);
    await renderer.init(orderedTriangles, nodes, mapData, materials, atlasBuilder);

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Ready!";
    
    // Setup Paint UI
    document.querySelector<HTMLElement>('#paint-ui')!.style.display = 'block';
    const paintToggle = document.querySelector<HTMLInputElement>('#paintModeToggle')!;
    const intensitySlider = document.querySelector<HTMLInputElement>('#intensitySlider')!;
    const intensityVal = document.querySelector<HTMLElement>('#intensityVal')!;
    const fwhmSlider = document.querySelector<HTMLInputElement>('#fwhmSlider')!;
    const fwhmVal = document.querySelector<HTMLElement>('#fwhmVal')!;
    const scaleSlider = document.querySelector<HTMLInputElement>('#scaleSlider')!;
    const scaleVal = document.querySelector<HTMLElement>('#scaleVal')!;
    const ambientSlider = document.querySelector<HTMLInputElement>('#ambientSlider')!;
    const ambientVal = document.querySelector<HTMLElement>('#ambientVal')!;
    const skySlider = document.querySelector<HTMLInputElement>('#skySlider')!;
    const skyVal = document.querySelector<HTMLElement>('#skyVal')!;
    const crosshair = document.querySelector<HTMLElement>('#crosshair')!;

    const smearSlider = document.querySelector<HTMLInputElement>('#smearSlider')!;
    const smearVal = document.querySelector<HTMLElement>('#smearVal')!;
    const volumetricToggle = document.querySelector<HTMLInputElement>('#volumetricToggle')!;
    const fogSlider = document.querySelector<HTMLInputElement>('#fogSlider')!;
    const fogVal = document.querySelector<HTMLElement>('#fogVal')!;
    const azimuthSlider = document.querySelector<HTMLInputElement>('#azimuthSlider')!;
    const azimuthVal = document.querySelector<HTMLElement>('#azimuthVal')!;
    const elevationSlider = document.querySelector<HTMLInputElement>('#elevationSlider')!;
    const elevationVal = document.querySelector<HTMLElement>('#elevationVal')!;
    const bounceSlider = document.querySelector<HTMLInputElement>('#bounceSlider')!;
    const bounceVal = document.querySelector<HTMLElement>('#bounceVal')!;

    paintToggle.addEventListener('change', () => {
      crosshair.style.display = paintToggle.checked ? 'block' : 'none';
    });
    intensitySlider.addEventListener('input', () => {
      intensityVal.innerText = intensitySlider.value;
    });
    fwhmSlider.addEventListener('input', () => {
      fwhmVal.innerText = fwhmSlider.value;
    });
    scaleSlider.addEventListener('input', () => {
      scaleVal.innerText = scaleSlider.value;
      renderer.renderScale = parseFloat(scaleSlider.value);
    });
    ambientSlider.addEventListener('input', () => {
      ambientVal.innerText = ambientSlider.value;
      renderer.ambientLight = parseFloat(ambientSlider.value);
    });
    skySlider.addEventListener('input', () => {
      skyVal.innerText = skySlider.value;
      renderer.skyLight = parseFloat(skySlider.value);
    });
    smearSlider.addEventListener('input', () => {
      smearVal.innerText = smearSlider.value;
      renderer.temporalBlend = parseFloat(smearSlider.value);
    });
    volumetricToggle.addEventListener('change', () => {
      renderer.volumetricsEnabled = volumetricToggle.checked;
    });
    fogSlider.addEventListener('input', () => {
      fogVal.innerText = fogSlider.value;
      renderer.fogDensity = parseFloat(fogSlider.value);
    });
    azimuthSlider.addEventListener('input', () => {
      azimuthVal.innerText = azimuthSlider.value;
      renderer.setSunAngle(parseFloat(azimuthSlider.value), parseFloat(elevationSlider.value));
    });
    elevationSlider.addEventListener('input', () => {
      elevationVal.innerText = elevationSlider.value;
      renderer.setSunAngle(parseFloat(azimuthSlider.value), parseFloat(elevationSlider.value));
    });
    bounceSlider.addEventListener('input', () => {
      bounceVal.innerText = bounceSlider.value;
      renderer.maxBounces = parseInt(bounceSlider.value);
    });

    window.addEventListener('mousedown', e => {
      if (document.pointerLockElement === canvas && paintToggle.checked && e.button === 0) {
        renderer.paintSurface(parseFloat(intensitySlider.value), parseFloat(fwhmSlider.value));
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
