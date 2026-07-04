import './style.css';
import { WadParser } from './WadParser.ts';
import { GeometryBuilder } from './GeometryBuilder.ts';
import { BvhBuilder } from './BvhBuilder.ts';
import { TextureAtlasBuilder } from './TextureAtlasBuilder.ts';
import { WebGpuRenderer } from './WebGpuRenderer.ts';

async function init() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  app.innerHTML = `
    <div id="ui" style="position: absolute; top: 10px; left: 10px; z-index: 10; background: rgba(0,0,0,0.7); padding: 15px; border-radius: 8px; max-width: 350px; color: white; max-height: 95vh; overflow-y: auto;">
      <h2 style="margin-top: 0;">WebGPU Doom Path Tracer</h2>
      <p id="status">Loading DOOM1.WAD...</p>
      <p style="font-size: 0.9em; color: #ccc;">Click on the canvas to lock pointer. Use WASD to move. Press '~' to toggle settings.</p>
      
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
          <label>Render Scale: <span id="scaleVal">0.3</span></label><br>
          <input type="range" id="scaleSlider" min="0.1" max="1.0" step="0.1" value="0.3" style="width: 100%;">
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
          <label>Temporal Smear: <span id="smearVal">0.8</span></label><br>
          <input type="range" id="smearSlider" min="0.0" max="1.0" step="0.01" value="0.8" style="width: 100%;">
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
        <div style="margin-top: 15px; text-align: center;">
          <button id="saveConfigBtn" style="width: 100%; padding: 8px; background: #555; color: white; border: none; border-radius: 4px; cursor: pointer;">Save Config</button>
          <span id="saveStatus" style="color: #0f0; display: none; font-size: 0.8em; margin-top: 5px;">Config Saved!</span>
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
    canvas.width = Math.floor(window.innerWidth * window.devicePixelRatio);
    canvas.height = Math.floor(window.innerHeight * window.devicePixelRatio);
    
    const renderer = new WebGpuRenderer(canvas);

    // Load config from localStorage
    const savedConfigStr = localStorage.getItem('doom_config');
    let savedConfig: any = null;
    if (savedConfigStr) {
      try {
        savedConfig = JSON.parse(savedConfigStr);
        if (savedConfig.paintedSurfaces) {
          const mapData = new Map(savedConfig.paintedSurfaces as [string, { intensity: number, fwhm: number }][]);
          renderer.paintedSurfaces = mapData;
        }
      } catch (e) {
        console.error('Failed to parse saved config', e);
      }
    }

    await renderer.init(orderedTriangles, nodes, mapData, materials, atlasBuilder);

    document.querySelector<HTMLParagraphElement>('#status')!.innerText = "Ready!";
    
    // Setup Paint UI
    document.querySelector<HTMLElement>('#paint-ui')!.style.display = 'block';
    const ui = document.querySelector<HTMLElement>('#ui')!;
    ui.style.display = 'none';
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

    const saveConfigBtn = document.querySelector<HTMLButtonElement>('#saveConfigBtn')!;
    const saveStatus = document.querySelector<HTMLElement>('#saveStatus')!;

    // Apply loaded UI values
    if (savedConfig && savedConfig.sliders) {
      const s = savedConfig.sliders;
      if (s.intensity !== undefined) intensitySlider.value = s.intensity;
      if (s.fwhm !== undefined) fwhmSlider.value = s.fwhm;
      if (s.scale !== undefined) scaleSlider.value = s.scale;
      if (s.ambient !== undefined) ambientSlider.value = s.ambient;
      if (s.sky !== undefined) skySlider.value = s.sky;
      if (s.azimuth !== undefined) azimuthSlider.value = s.azimuth;
      if (s.elevation !== undefined) elevationSlider.value = s.elevation;
      if (s.smear !== undefined) smearSlider.value = s.smear;
      if (s.volumetric !== undefined) volumetricToggle.checked = s.volumetric;
      if (s.fog !== undefined) fogSlider.value = s.fog;
      if (s.bounces !== undefined) bounceSlider.value = s.bounces;
    }

    // Initialize UI display text & Renderer State
    intensityVal.innerText = intensitySlider.value;
    fwhmVal.innerText = fwhmSlider.value;
    scaleVal.innerText = scaleSlider.value;
    ambientVal.innerText = ambientSlider.value;
    skyVal.innerText = skySlider.value;
    azimuthVal.innerText = azimuthSlider.value;
    elevationVal.innerText = elevationSlider.value;
    smearVal.innerText = smearSlider.value;
    fogVal.innerText = fogSlider.value;
    bounceVal.innerText = bounceSlider.value;

    renderer.renderScale = parseFloat(scaleSlider.value);
    renderer.ambientLight = parseFloat(ambientSlider.value);
    renderer.skyLight = parseFloat(skySlider.value);
    renderer.setSunAngle(parseFloat(azimuthSlider.value), parseFloat(elevationSlider.value));
    renderer.temporalBlend = 1.0 - (parseFloat(smearSlider.value) * 0.99);
    renderer.volumetricsEnabled = volumetricToggle.checked;
    renderer.fogDensity = parseFloat(fogSlider.value);
    renderer.maxBounces = parseInt(bounceSlider.value);

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
      // Invert the slider logic: 0 means no smear (blend = 1.0), 1 means max smear (blend = 0.01)
      renderer.temporalBlend = 1.0 - (parseFloat(smearSlider.value) * 0.99);
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

    saveConfigBtn.addEventListener('click', () => {
      const config = {
        sliders: {
          intensity: intensitySlider.value,
          fwhm: fwhmSlider.value,
          scale: scaleSlider.value,
          ambient: ambientSlider.value,
          sky: skySlider.value,
          azimuth: azimuthSlider.value,
          elevation: elevationSlider.value,
          smear: smearSlider.value,
          volumetric: volumetricToggle.checked,
          fog: fogSlider.value,
          bounces: bounceSlider.value
        },
        paintedSurfaces: Array.from(renderer.paintedSurfaces.entries())
      };
      
      localStorage.setItem('doom_config', JSON.stringify(config));
      
      saveStatus.style.display = 'block';
      setTimeout(() => {
        saveStatus.style.display = 'none';
      }, 2000);
    });

    window.addEventListener('mousedown', e => {
      if (document.pointerLockElement === canvas && paintToggle.checked && e.button === 0) {
        renderer.paintSurface(parseFloat(intensitySlider.value), parseFloat(fwhmSlider.value));
      }
    });

    // Input handling
    let keys: Record<string, boolean> = {};
    const moveSpeed = 0.2;
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Backquote') {
        const ui = document.querySelector<HTMLElement>('#ui')!;
        ui.style.display = ui.style.display === 'none' ? 'block' : 'none';
      }
      if (e.code === 'Space' && !e.repeat) {
        checkInteraction();
      }
    });
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

    const sensitivity = 0.002;

    interface ActiveDoor {
      sectorIdx: number;
      targetHeight: number;
      originalHeight: number;
      state: 'opening' | 'open' | 'closing';
      timer: number;
    }
    const activeDoors: ActiveDoor[] = [];
    const doorSpeed = 0.12;

    function checkInteraction() {
      const pX = renderer.pos[0];
      const pZ = renderer.pos[2];
      const dirX = Math.cos(renderer.yaw);
      const dirZ = Math.sin(renderer.yaw);
      const reach = 64.0;
      const endX = pX + dirX * reach;
      const endZ = pZ + dirZ * reach;

      let closestDist = reach;
      let hitLinedef = null;

      for (const line of mapData.linedefs) {
        const v1 = mapData.vertexes[line.v1];
        const v2 = mapData.vertexes[line.v2];
        
        const x1 = pX, y1 = pZ;
        const x2 = endX, y2 = endZ;
        const x3 = v1.x, y3 = v1.y;
        const x4 = v2.x, y4 = v2.y;

        const denom = (y4 - y3)*(x2 - x1) - (x4 - x3)*(y2 - y1);
        if (denom === 0) continue;

        const ua = ((x4 - x3)*(y1 - y3) - (y4 - y3)*(x1 - x3)) / denom;
        const ub = ((x2 - x1)*(y1 - y3) - (y2 - y1)*(x1 - x3)) / denom;

        if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
          const dist = ua * reach;
          // Only interact with special lines or solid walls (which block interaction)
          if (line.special > 0 || line.sidenum[1] === -1) {
            if (dist < closestDist) {
              closestDist = dist;
              hitLinedef = line;
            }
          }
        }
      }

      if (hitLinedef && hitLinedef.special > 0 && hitLinedef.sidenum[1] !== -1) {
        const side = mapData.sidedefs[hitLinedef.sidenum[1]];
        const sector = mapData.sectors[side.sector];
        
        let lowestNeighbor = Infinity;
        for (const line of mapData.linedefs) {
          if (line.sidenum[0] !== -1 && line.sidenum[1] !== -1) {
            const sec0 = mapData.sidedefs[line.sidenum[0]].sector;
            const sec1 = mapData.sidedefs[line.sidenum[1]].sector;
            if (sec0 === side.sector) lowestNeighbor = Math.min(lowestNeighbor, mapData.sectors[sec1].ceilingheight);
            if (sec1 === side.sector) lowestNeighbor = Math.min(lowestNeighbor, mapData.sectors[sec0].ceilingheight);
          }
        }

        if (lowestNeighbor > sector.ceilingheight && lowestNeighbor !== Infinity) {
          const doorSectorIdx = side.sector;
          const targetH = lowestNeighbor - 4;
          const existing = activeDoors.find(d => d.sectorIdx === doorSectorIdx);
          
          if (existing) {
            if (existing.state === 'closing') {
              existing.state = 'opening';
            }
          } else {
            activeDoors.push({ 
              sectorIdx: doorSectorIdx, 
              targetHeight: targetH,
              originalHeight: sector.ceilingheight,
              state: 'opening',
              timer: 0
            });
          }
        }
      }
    }

    let lastTime = 0;
    function frame(time: number) {
      if (lastTime === 0) lastTime = time;
      const dt = time - lastTime;
      lastTime = time;

      let dx = 0;
      let dz = 0;
      let currentSpeed = moveSpeed;
      
      if (keys['ShiftLeft'] || keys['ShiftRight']) {
        currentSpeed *= 2.0; // Double speed when running
      }

      if (keys['KeyW']) dz += currentSpeed * dt;
      if (keys['KeyS']) dz -= currentSpeed * dt;
      if (keys['KeyA']) dx -= currentSpeed * dt;
      if (keys['KeyD']) dx += currentSpeed * dt;

      renderer.updateCamera(dx, dz, mouseDeltaX * sensitivity, -mouseDeltaY * sensitivity);

      mouseDeltaX = 0;
      mouseDeltaY = 0;

      let geometryChanged = false;
      for (let i = activeDoors.length - 1; i >= 0; i--) {
        const door = activeDoors[i];
        const sector = mapData.sectors[door.sectorIdx];
        
        if (door.state === 'opening') {
          sector.ceilingheight += doorSpeed * dt;
          if (sector.ceilingheight >= door.targetHeight) {
            sector.ceilingheight = door.targetHeight;
            door.state = 'open';
            door.timer = 3000; // 3 seconds
          }
          geometryChanged = true;
        } else if (door.state === 'open') {
          door.timer -= dt;
          if (door.timer <= 0) {
            door.state = 'closing';
          }
        } else if (door.state === 'closing') {
          sector.ceilingheight -= doorSpeed * dt;
          if (sector.ceilingheight <= door.originalHeight) {
            sector.ceilingheight = door.originalHeight;
            activeDoors.splice(i, 1);
          }
          geometryChanged = true;
        }
      }

      if (geometryChanged) {
        const newGeo = new GeometryBuilder(mapData, atlasBuilder);
        const { triangles } = newGeo.build();
        const newBvh = new BvhBuilder(triangles);
        const { nodes, orderedTriangles } = newBvh.build();
        renderer.updateGeometry(orderedTriangles, nodes);
      }

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
