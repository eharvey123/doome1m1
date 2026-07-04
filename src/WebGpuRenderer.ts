import shaderCode from './shader.wgsl?raw';
import type { Triangle, MaterialDef } from './GeometryBuilder.ts';
import type { BvhNode } from './BvhBuilder.ts';
import { vec3 } from 'gl-matrix';
import type { MapData } from './WadParser.ts';
import type { TextureAtlasBuilder } from './TextureAtlasBuilder.ts';

export class WebGpuRenderer {
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private computePipeline!: GPUComputePipeline;
  private lightTracePipeline!: GPUComputePipeline;
  private renderPipeline!: GPURenderPipeline;
  private bindGroup0!: GPUBindGroup;
  private bindGroup1!: GPUBindGroup;
  private lightBindGroup0!: GPUBindGroup;
  private lightBindGroup1!: GPUBindGroup;
  private screenBindGroup0!: GPUBindGroup;
  private screenBindGroup1!: GPUBindGroup;
  
  private cameraBuffer!: GPUBuffer;
  private matBuffer!: GPUBuffer;
  private lightBuffer!: GPUBuffer;
  private lightIndices: number[] = [];
  private historyTex0!: GPUTexture;
  private historyTex1!: GPUTexture;
  private atlasTexture!: GPUTexture;
  private splatBuffer!: GPUBuffer;
  
  private frameCounter = 0;
  
  // Camera state
  private _pos: vec3 = vec3.fromValues(1056, 150, -3600); // Start position (rough E1M1 spawn)
  private _yaw = Math.PI / 2;
  private pitch = 0;
  private _ambientLight = 0.05;
  private _skyLight = 1.0;
  private _renderScale = 0.3;
  private _temporalBlend = 0.2;
  private framesStill = 0;
  private _volumetricsEnabled = false;
  private _fogDensity = 0.002;
  private _sunDir = vec3.fromValues(0.5, 0.707, 0.5);
  private _maxBounces = 2;

  private bvhBuffer!: GPUBuffer;

  public set ambientLight(val: number) {
    this._ambientLight = val;
    this.frameCounter = 0;
  }
  public get ambientLight() { return this._ambientLight; }

  public set skyLight(val: number) {
    this._skyLight = val;
    this.frameCounter = 0;
  }
  public get skyLight() { return this._skyLight; }

  public get pos() { return this._pos; }
  public get yaw() { return this._yaw; }

  public set renderScale(val: number) {
    if (this._renderScale !== val) {
      this._renderScale = val;
      this.recreateTextures();
    }
  }
  public get renderScale() { return this._renderScale; }

  public set temporalBlend(val: number) { this._temporalBlend = val; }
  public get temporalBlend() { return this._temporalBlend; }

  public set volumetricsEnabled(val: boolean) { this._volumetricsEnabled = val; this.frameCounter = 0; }
  public get volumetricsEnabled() { return this._volumetricsEnabled; }

  public set fogDensity(val: number) { this._fogDensity = val; this.frameCounter = 0; }
  public get fogDensity() { return this._fogDensity; }

  public set maxBounces(val: number) { this._maxBounces = Math.max(1, Math.floor(val)); this.frameCounter = 0; }
  public get maxBounces() { return this._maxBounces; }

  public setSunAngle(azimuthDeg: number, elevationDeg: number) {
    const az = azimuthDeg * Math.PI / 180;
    const el = elevationDeg * Math.PI / 180;
    this._sunDir[0] = Math.cos(el) * Math.cos(az);
    this._sunDir[1] = Math.sin(el);
    this._sunDir[2] = Math.cos(el) * Math.sin(az);
    vec3.normalize(this._sunDir, this._sunDir);
    this.frameCounter = 0;
  }

  private get renderWidth() { return Math.max(1, Math.floor(this.canvas.width * this._renderScale)); }
  private get renderHeight() { return Math.max(1, Math.floor(this.canvas.height * this._renderScale)); }

  private canvas: HTMLCanvasElement;
  private mapData!: MapData;
  private floorTriangles: Triangle[] = [];
  
  private triBuffer!: GPUBuffer;
  private triangles!: Triangle[];
  private bvhNodes!: BvhNode[];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  async init(triangles: Triangle[], bvhNodes: BvhNode[], mapData: MapData, materials: MaterialDef[], atlasBuilder: TextureAtlasBuilder) {
    this.mapData = mapData;
    this.triangles = triangles;
    this.bvhNodes = bvhNodes;
    this.floorTriangles = triangles.filter(t => t.normal[1] > 0.9);
    if (!navigator.gpu) throw new Error("WebGPU not supported");
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No adapter found");
    this.device = await adapter.requestDevice();

    this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: presentationFormat,
    });

    // Create Buffers
    const triBufferSize = triangles.length * 96; // 96 bytes per Triangle (24 floats)
    this.triBuffer = this.device.createBuffer({
      size: triBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    const triMapped = this.triBuffer.getMappedRange();
    const triArray = new Float32Array(triMapped);
    const triUintArray = new Uint32Array(triMapped);
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];
      let offset = i * 24; // 24 floats
      triArray[offset+0] = t.v0[0]; triArray[offset+1] = t.v0[1]; triArray[offset+2] = t.v0[2];
      triUintArray[offset+3] = t.materialIndex;
      triArray[offset+4] = t.v1[0] - t.v0[0]; triArray[offset+5] = t.v1[1] - t.v0[1]; triArray[offset+6] = t.v1[2] - t.v0[2];
      triArray[offset+7] = t.emissivity;
      triArray[offset+8] = t.v2[0] - t.v0[0]; triArray[offset+9] = t.v2[1] - t.v0[1]; triArray[offset+10] = t.v2[2] - t.v0[2];
      triArray[offset+11] = t.emissionExp;
      triArray[offset+12] = t.normal[0]; triArray[offset+13] = t.normal[1]; triArray[offset+14] = t.normal[2];
      
      triArray[offset+16] = t.uv0[0]; triArray[offset+17] = t.uv0[1];
      triArray[offset+18] = t.uv1[0]; triArray[offset+19] = t.uv1[1];
      triArray[offset+20] = t.uv2[0]; triArray[offset+21] = t.uv2[1];
      // pad4 at +22, +23
    }
    this.triBuffer.unmap();

    const bvhBufferSize = Math.max(bvhNodes.length * 32, 32); // 32 bytes per BvhNode
    this.bvhBuffer = this.device.createBuffer({
      size: Math.max(bvhBufferSize, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    if (bvhNodes.length > 0) {
      const bvhMapped = this.bvhBuffer.getMappedRange();
      const bvhArray = new Float32Array(bvhMapped);
      const bvhUintArray = new Uint32Array(bvhMapped);
      for (let i = 0; i < bvhNodes.length; i++) {
        const n = bvhNodes[i];
        let offset = i * 8; // 8 floats
        bvhArray[offset+0] = n.aabbMin[0]; bvhArray[offset+1] = n.aabbMin[1]; bvhArray[offset+2] = n.aabbMin[2];
        bvhUintArray[offset+3] = n.leftFirst;
        bvhArray[offset+4] = n.aabbMax[0]; bvhArray[offset+5] = n.aabbMax[1]; bvhArray[offset+6] = n.aabbMax[2];
        bvhUintArray[offset+7] = n.triCount;
      }
    }
    this.bvhBuffer.unmap();

    this.cameraBuffer = this.device.createBuffer({
      size: 40 * 4, // 40 floats (160 bytes)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.matBuffer = this.device.createBuffer({
      size: Math.max(materials.length * 32, 32), // 32 bytes per material (8 floats)
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    if (materials.length > 0) {
      const matArray = new Float32Array(this.matBuffer.getMappedRange());
      for (let i = 0; i < materials.length; i++) {
        const m = materials[i].atlas;
        const off = i * 8;
        matArray[off+0] = m.u; matArray[off+1] = m.v;
        matArray[off+2] = m.w; matArray[off+3] = m.h;
        matArray[off+4] = m.width; matArray[off+5] = m.height;
        matArray[off+6] = m.isOpaque ? 1.0 : 0.0;
      }
    }
    this.matBuffer.unmap();

    this.lightBuffer = this.device.createBuffer({
      size: Math.max(1024 * 4, 4), // Up to 1024 lights
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.atlasTexture = this.device.createTexture({
      size: [atlasBuilder.atlasWidth, atlasBuilder.atlasHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: this.atlasTexture },
      atlasBuilder.atlasData,
      { bytesPerRow: atlasBuilder.atlasWidth * 4, rowsPerImage: atlasBuilder.atlasHeight },
      [atlasBuilder.atlasWidth, atlasBuilder.atlasHeight]
    );

    this.createTextures();

    const shaderModule = this.device.createShaderModule({ code: shaderCode });

    this.computePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      }
    });

    this.lightTracePipeline = this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'lightTrace',
      }
    });

    // Render pipeline for copying texture to screen
    const fullscreenWGSL = `
      struct VSOutput {
        @builtin(position) pos: vec4<f32>,
        @location(0) uv: vec2<f32>,
      }
      @vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOutput {
        var out: VSOutput;
        var pos = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
        out.pos = vec4<f32>(pos[vi], 0.0, 1.0);
        out.uv = pos[vi] * 0.5 + vec2<f32>(0.5, 0.5);
        out.uv.y = 1.0 - out.uv.y;
        return out;
      }
      @group(0) @binding(0) var tex: texture_2d<f32>;
      @group(0) @binding(1) var samp: sampler;
      @fragment fn fs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
        var c = textureSample(tex, samp, uv).rgb;
        
        // ACES filmic tonemapping curve
        let a = 2.51;
        let b = 0.03;
        let cc = 2.43;
        let d = 0.59;
        let e = 0.14;
        c = clamp((c * (a * c + b)) / (c * (cc * c + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
        
        // Gamma correction
        c = pow(c, vec3<f32>(1.0/2.2));
        
        return vec4<f32>(c, 1.0);
      }
    `;
    this.renderPipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: this.device.createShaderModule({ code: fullscreenWGSL }), entryPoint: 'vs' },
      fragment: {
        module: this.device.createShaderModule({ code: fullscreenWGSL }),
        entryPoint: 'fs',
        targets: [{ format: presentationFormat }]
      }
    });

    // Now that renderPipeline exists, create screen bind groups
    this.createBindGroup(this.triBuffer, this.bvhBuffer, this.matBuffer);
    this.createScreenBindGroups();
  }

  private createTextures() {
    this.historyTex0 = this.device.createTexture({
      size: [this.renderWidth, this.renderHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    this.historyTex1 = this.device.createTexture({
      size: [this.renderWidth, this.renderHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });

    // Create/recreate splat buffer for light tracing
    if (this.splatBuffer) {
      this.splatBuffer.destroy();
    }
    this.splatBuffer = this.device.createBuffer({
      size: this.renderWidth * this.renderHeight * 3 * 4, // 3 u32 per pixel (R, G, B)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private recreateTextures() {
    this.createTextures();
    this.createBindGroup(this.triBuffer, this.bvhBuffer, this.matBuffer);
    this.createScreenBindGroups();
    this.frameCounter = 0;
  }

  private createBindGroup(triBuffer: GPUBuffer, bvhBuffer: GPUBuffer, matBuffer: GPUBuffer) {
    const atlasSampler = this.device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
    const historySampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    
    this.bindGroup0 = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: triBuffer } },
        { binding: 1, resource: { buffer: bvhBuffer } },
        { binding: 2, resource: { buffer: this.cameraBuffer } },
        { binding: 3, resource: this.historyTex1.createView() }, // Write to 1
        { binding: 4, resource: this.historyTex0.createView() }, // Read from 0
        { binding: 5, resource: { buffer: matBuffer } },
        { binding: 6, resource: this.atlasTexture.createView() },
        { binding: 7, resource: atlasSampler },
        { binding: 8, resource: { buffer: this.lightBuffer } },
        { binding: 9, resource: historySampler },
        { binding: 10, resource: { buffer: this.splatBuffer } },
      ]
    });

    this.bindGroup1 = this.device.createBindGroup({
      layout: this.computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: triBuffer } },
        { binding: 1, resource: { buffer: bvhBuffer } },
        { binding: 2, resource: { buffer: this.cameraBuffer } },
        { binding: 3, resource: this.historyTex0.createView() }, // Write to 0
        { binding: 4, resource: this.historyTex1.createView() }, // Read from 1
        { binding: 5, resource: { buffer: matBuffer } },
        { binding: 6, resource: this.atlasTexture.createView() },
        { binding: 7, resource: atlasSampler },
        { binding: 8, resource: { buffer: this.lightBuffer } },
        { binding: 9, resource: historySampler },
        { binding: 10, resource: { buffer: this.splatBuffer } },
      ]
    });

    // Light trace bind groups (separate layout from lightTracePipeline)
    // Note: lightTrace doesn't use historyTexRead (4) or historySamp (9)
    this.lightBindGroup0 = this.device.createBindGroup({
      layout: this.lightTracePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: triBuffer } },
        { binding: 1, resource: { buffer: bvhBuffer } },
        { binding: 2, resource: { buffer: this.cameraBuffer } },
        { binding: 3, resource: this.historyTex1.createView() },
        { binding: 5, resource: { buffer: matBuffer } },
        { binding: 6, resource: this.atlasTexture.createView() },
        { binding: 7, resource: atlasSampler },
        { binding: 8, resource: { buffer: this.lightBuffer } },
        { binding: 10, resource: { buffer: this.splatBuffer } },
      ],
    });
    this.lightBindGroup1 = this.device.createBindGroup({
      layout: this.lightTracePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: triBuffer } },
        { binding: 1, resource: { buffer: bvhBuffer } },
        { binding: 2, resource: { buffer: this.cameraBuffer } },
        { binding: 3, resource: this.historyTex0.createView() },
        { binding: 5, resource: { buffer: matBuffer } },
        { binding: 6, resource: this.atlasTexture.createView() },
        { binding: 7, resource: atlasSampler },
        { binding: 8, resource: { buffer: this.lightBuffer } },
        { binding: 10, resource: { buffer: this.splatBuffer } },
      ],
    });
  }

  private createScreenBindGroups() {
    const screenSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    this.screenBindGroup0 = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.historyTex1.createView() },
        { binding: 1, resource: screenSampler },
      ]
    });
    this.screenBindGroup1 = this.device.createBindGroup({
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.historyTex0.createView() },
        { binding: 1, resource: screenSampler },
      ]
    });
  }

  private updateLightBuffer() {
    if (this.lightIndices.length > 0) {
      const data = new Uint32Array(this.lightIndices);
      this.device.queue.writeBuffer(this.lightBuffer, 0, data);
    }
  }

  private pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
    const v0x = cx - ax;
    const v0y = cy - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = px - ax;
    const v2y = py - ay;

    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;

    const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return (u >= 0) && (v >= 0) && (u + v <= 1);
  }

  public paintSurface(intensity: number, fwhm: number) {
    // Determine ray direction
    const dir = vec3.fromValues(
      Math.cos(this.pitch) * Math.cos(this._yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.sin(this._yaw)
    );
    vec3.normalize(dir, dir);

    let hitT = Infinity;
    let hitTriIdx = -1;

    // Simple recursive or iterative traversal
    const stack: number[] = [0]; // root
    const invDir = vec3.fromValues(1 / dir[0], 1 / dir[1], 1 / dir[2]);

    while (stack.length > 0) {
      const nodeIdx = stack.pop()!;
      const node = this.bvhNodes[nodeIdx];

      // AABB intersect
      let tmin = -Infinity;
      let tmax = Infinity;
      for (let i = 0; i < 3; i++) {
        const t1 = (node.aabbMin[i] - this._pos[i]) * invDir[i];
        const t2 = (node.aabbMax[i] - this._pos[i]) * invDir[i];
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
      }

      if (tmax < 0 || tmin > tmax || tmin > hitT) continue;

      if (node.triCount > 0) {
        // Leaf node
        for (let i = 0; i < node.triCount; i++) {
          const triIdx = node.leftFirst + i;
          const tri = this.triangles[triIdx];
          
          // Triangle intersect (Möller-Trumbore)
          const edge1 = vec3.subtract(vec3.create(), tri.v1, tri.v0);
          const edge2 = vec3.subtract(vec3.create(), tri.v2, tri.v0);
          const h = vec3.cross(vec3.create(), dir, edge2);
          const a = vec3.dot(edge1, h);

          if (a > -0.00001 && a < 0.00001) continue; // parallel

          const f = 1.0 / a;
          const s = vec3.subtract(vec3.create(), this._pos, tri.v0);
          const u = f * vec3.dot(s, h);

          if (u < 0.0 || u > 1.0) continue;

          const q = vec3.cross(vec3.create(), s, edge1);
          const v = f * vec3.dot(dir, q);

          if (v < 0.0 || u + v > 1.0) continue;

          const t = f * vec3.dot(edge2, q);
          if (t > 0.001 && t < hitT) {
            hitT = t;
            hitTriIdx = triIdx;
          }
        }
      } else {
        stack.push(node.leftFirst + 1); // Right
        stack.push(node.leftFirst);     // Left
      }
    }

    if (hitTriIdx !== -1) {
      console.log("Painted triangle", hitTriIdx, "with intensity", intensity, "and fwhm", fwhm);
      let exp = 0.0;
      if (fwhm < 180) {
        const cosHalf = Math.cos(fwhm * 0.5 * Math.PI / 180.0);
        if (cosHalf > 0) {
          exp = Math.log(0.5) / Math.log(cosHalf);
        }
      }
      this.triangles[hitTriIdx].emissivity = intensity;
      this.triangles[hitTriIdx].emissionExp = exp;
      
      const idxInLights = this.lightIndices.indexOf(hitTriIdx);
      if (intensity > 0 && idxInLights === -1) {
        this.lightIndices.push(hitTriIdx);
        this.updateLightBuffer();
      } else if (intensity === 0 && idxInLights !== -1) {
        this.lightIndices.splice(idxInLights, 1);
        this.updateLightBuffer();
      }
      
      // Update GPU buffer
      // Tri struct size = 96 bytes. Emissivity is at byte offset 28 (7th float)
      const byteOffset = hitTriIdx * 96 + 28;
      this.device.queue.writeBuffer(
        this.triBuffer,
        byteOffset,
        new Float32Array([intensity])
      );

      // emissionExp is at byte offset 44 (11th float)
      const expOffset = hitTriIdx * 96 + 44;
      this.device.queue.writeBuffer(
        this.triBuffer,
        expOffset,
        new Float32Array([exp])
      );

      // Reset accumulation buffer to instantly see the new light
      this.frameCounter = 0;
    }
  }

  private prevPos = vec3.create();
  private prevDir = vec3.create();
  private prevRight = vec3.create();
  private prevUp = vec3.create();

  public updateCamera(dx: number, dz: number, dyaw: number, dpitch: number) {
    if (dx !== 0 || dz !== 0 || dyaw !== 0 || dpitch !== 0) {
      this.framesStill = 0;
    } else {
      this.framesStill++;
    }
    
    this._yaw += dyaw;
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch + dpitch));

    const dir = vec3.fromValues(
      Math.cos(this.pitch) * Math.cos(this._yaw),
      Math.sin(this.pitch),
      Math.cos(this.pitch) * Math.sin(this._yaw)
    );
    const right = vec3.cross(vec3.create(), dir, vec3.fromValues(0, 1, 0));
    vec3.normalize(right, right);
    
    const up = vec3.cross(vec3.create(), right, dir);

    const move = vec3.create();
    vec3.scaleAndAdd(move, move, dir, dz);
    vec3.scaleAndAdd(move, move, right, dx);
    move[1] = 0; // Flat movement initially
    
    let pX = this._pos[0] + move[0];
    let pZ = this._pos[2] + move[2];
    const radius = 16;
    const playerZ = this._pos[1] - 41;

    // Wall collision (3 passes for corners)
    for (let pass = 0; pass < 3; pass++) {
        for (const line of this.mapData.linedefs) {
            const v1 = this.mapData.vertexes[line.v1];
            const v2 = this.mapData.vertexes[line.v2];
            
            const ldx = v2.x - v1.x;
            const ldy = v2.y - v1.y;
            const lengthSq = ldx * ldx + ldy * ldy;
            
            let t = 0;
            if (lengthSq > 0) {
                t = ((pX - v1.x) * ldx + (pZ - v1.y) * ldy) / lengthSq;
                t = Math.max(0, Math.min(1, t));
            }
            
            const closestX = v1.x + t * ldx;
            const closestZ = v1.y + t * ldy;
            
            const distSq = (pX - closestX) * (pX - closestX) + (pZ - closestZ) * (pZ - closestZ);
            if (distSq < radius * radius && distSq > 0.0001) {
                let solid = false;
                if (line.sidenum[1] === -1) {
                    solid = true;
                } else {
                    const frontSide = this.mapData.sidedefs[line.sidenum[0]];
                    const backSide = this.mapData.sidedefs[line.sidenum[1]];
                    const frontSec = this.mapData.sectors[frontSide.sector];
                    const backSec = this.mapData.sectors[backSide.sector];
                    
                    const highestFloor = Math.max(frontSec.floorheight, backSec.floorheight);
                    const lowestCeil = Math.min(frontSec.ceilingheight, backSec.ceilingheight);
                    
                    if (highestFloor > playerZ + 24) solid = true;
                    if (lowestCeil - highestFloor < 56) solid = true;
                }
                
                if (solid) {
                    const dist = Math.sqrt(distSq);
                    const pushDist = radius - dist + 0.01;
                    const pushX = (pX - closestX) / dist;
                    const pushZ = (pZ - closestZ) / dist;
                    pX += pushX * pushDist;
                    pZ += pushZ * pushDist;
                }
            }
        }
    }

    // Find floor height
    let targetFloor = playerZ;
    for (const t of this.floorTriangles) {
        if (this.pointInTriangle(pX, pZ, t.v0[0], t.v0[2], t.v1[0], t.v1[2], t.v2[0], t.v2[2])) {
            targetFloor = t.v0[1];
            break;
        }
    }

    const targetY = targetFloor + 41;
    
    // Smooth height transition
    this.pos[0] = pX;
    this.pos[2] = pZ;
    this.pos[1] += (targetY - this.pos[1]) * 0.2; 

    const camData = new Float32Array([
      this.pos[0], this.pos[1], this.pos[2], 0,
      dir[0], dir[1], dir[2], this._ambientLight,
      right[0], right[1], right[2], this._skyLight,
      up[0], up[1], up[2], this.lightIndices.length,
      
      this.prevPos[0], this.prevPos[1], this.prevPos[2], this.renderWidth / this.renderHeight,
      this.prevDir[0], this.prevDir[1], this.prevDir[2], 0, // framesStill (uint)
      this.prevRight[0], this.prevRight[1], this.prevRight[2], this._temporalBlend,
      this.prevUp[0], this.prevUp[1], this.prevUp[2], this._fogDensity,
      
      this._sunDir[0], this._sunDir[1], this._sunDir[2], 0,
      0, 0, 0, 0,
    ]);
    const camUint = new Uint32Array(camData.buffer);
    camUint[3] = this.frameCounter;
    camUint[15] = this.lightIndices.length;
    camUint[23] = this.framesStill;
    camUint[35] = this._volumetricsEnabled ? 1 : 0;
    camUint[36] = this._maxBounces;

    this.device.queue.writeBuffer(this.cameraBuffer, 0, camData);
    
    // Save previous camera state
    vec3.copy(this.prevPos, this.pos);
    vec3.copy(this.prevDir, dir);
    vec3.copy(this.prevRight, right);
    vec3.copy(this.prevUp, up);
  }

  public updateGeometry(triangles: Triangle[], bvhNodes: BvhNode[]) {
    // Update Triangles
    const triArray = new Float32Array(triangles.length * 24);
    const triUintArray = new Uint32Array(triArray.buffer);
    for (let i = 0; i < triangles.length; i++) {
      const t = triangles[i];
      let offset = i * 24; // 24 floats
      triArray[offset+0] = t.v0[0]; triArray[offset+1] = t.v0[1]; triArray[offset+2] = t.v0[2];
      triUintArray[offset+3] = t.materialIndex;
      triArray[offset+4] = t.v1[0] - t.v0[0]; triArray[offset+5] = t.v1[1] - t.v0[1]; triArray[offset+6] = t.v1[2] - t.v0[2];
      triArray[offset+7] = t.emissivity;
      triArray[offset+8] = t.v2[0] - t.v0[0]; triArray[offset+9] = t.v2[1] - t.v0[1]; triArray[offset+10] = t.v2[2] - t.v0[2];
      triArray[offset+11] = t.emissionExp;
      triArray[offset+12] = t.normal[0]; triArray[offset+13] = t.normal[1]; triArray[offset+14] = t.normal[2];
      
      triArray[offset+16] = t.uv0[0]; triArray[offset+17] = t.uv0[1];
      triArray[offset+18] = t.uv1[0]; triArray[offset+19] = t.uv1[1];
      triArray[offset+20] = t.uv2[0]; triArray[offset+21] = t.uv2[1];
    }
    this.device.queue.writeBuffer(this.triBuffer, 0, triArray.buffer);

    // Update BVH
    if (bvhNodes.length > 0) {
      const bvhArray = new Float32Array(bvhNodes.length * 8);
      const bvhUintArray = new Uint32Array(bvhArray.buffer);
      for (let i = 0; i < bvhNodes.length; i++) {
        const n = bvhNodes[i];
        let offset = i * 8; // 8 floats
        bvhArray[offset+0] = n.aabbMin[0]; bvhArray[offset+1] = n.aabbMin[1]; bvhArray[offset+2] = n.aabbMin[2];
        bvhUintArray[offset+3] = n.leftFirst;
        bvhArray[offset+4] = n.aabbMax[0]; bvhArray[offset+5] = n.aabbMax[1]; bvhArray[offset+6] = n.aabbMax[2];
        bvhUintArray[offset+7] = n.triCount;
      }
      this.device.queue.writeBuffer(this.bvhBuffer, 0, bvhArray.buffer);
    }
    
    // Reset accumulation
    this.frameCounter = 0;
  }

  public render() {
    this.updateCamera(0, 0, 0, 0); // Just to push frameCounter

    const encoder = this.device.createCommandEncoder();

    // Clear splat buffer each frame
    encoder.clearBuffer(this.splatBuffer);
    
    // Light trace pass (bidirectional - traces from lights to camera)
    const lightPass = encoder.beginComputePass();
    lightPass.setPipeline(this.lightTracePipeline);
    lightPass.setBindGroup(0, this.frameCounter % 2 === 0 ? this.lightBindGroup0 : this.lightBindGroup1);
    lightPass.dispatchWorkgroups(
      Math.ceil(this.renderWidth / 8),
      Math.ceil(this.renderHeight / 8)
    );
    lightPass.end();
    
    // Camera trace pass (reads splat buffer contributions)
    const computePass = encoder.beginComputePass();
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, this.frameCounter % 2 === 0 ? this.bindGroup0 : this.bindGroup1);
    computePass.dispatchWorkgroups(
      Math.ceil(this.renderWidth / 8),
      Math.ceil(this.renderHeight / 8)
    );
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 },
        storeOp: 'store'
      }]
    });
    renderPass.setPipeline(this.renderPipeline);
    renderPass.setBindGroup(0, this.frameCounter % 2 === 0 ? this.screenBindGroup0 : this.screenBindGroup1);
    renderPass.draw(3);
    renderPass.end();

    this.device.queue.submit([encoder.finish()]);
    
    this.frameCounter++;
  }
}
