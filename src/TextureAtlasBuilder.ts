import type { WadParser, MapData } from './WadParser.ts';

export interface AtlasRect {
  u: number;
  v: number;
  width: number;
  height: number;
  w: number; // width in UV space [0..1]
  h: number; // height in UV space [0..1]
  isOpaque: boolean;
}

export class TextureAtlasBuilder {
  public atlasData!: Uint8Array;
  public atlasWidth = 2048;
  public atlasHeight = 2048;
  public textureMap = new Map<string, AtlasRect>();
  
  // Keep track of packing
  private currentX = 0;
  private currentY = 0;
  private rowHeight = 0;

  private wad: WadParser;
  private mapData: MapData;

  constructor(wad: WadParser, mapData: MapData) {
    this.wad = wad;
    this.mapData = mapData;
  }

  public build() {
    this.atlasData = new Uint8Array(this.atlasWidth * this.atlasHeight * 4);

    // 1. Gather all required texture names
    const requiredTextures = new Set<string>();
    const requiredFlats = new Set<string>();

    for (const side of this.mapData.sidedefs) {
      if (side.toptexture !== '-') requiredTextures.add(side.toptexture);
      if (side.bottomtexture !== '-') requiredTextures.add(side.bottomtexture);
      if (side.midtexture !== '-') requiredTextures.add(side.midtexture);
    }
    for (const sec of this.mapData.sectors) {
      if (sec.floorpic !== 'F_SKY1') requiredFlats.add(sec.floorpic);
      if (sec.ceilingpic !== 'F_SKY1') requiredFlats.add(sec.ceilingpic);
    }

    // 2. Build Textures
    for (const texName of requiredTextures) {
      this.buildTexture(texName);
    }

    // 3. Build Flats
    for (const flatName of requiredFlats) {
      this.buildFlat(flatName);
    }
  }

  private allocateRect(width: number, height: number): { x: number, y: number } {
    if (this.currentX + width > this.atlasWidth) {
      this.currentX = 0;
      this.currentY += this.rowHeight;
      this.rowHeight = 0;
    }
    if (this.currentY + height > this.atlasHeight) {
      throw new Error("Texture atlas too small!");
    }
    
    const x = this.currentX;
    const y = this.currentY;
    
    this.currentX += width;
    this.rowHeight = Math.max(this.rowHeight, height);
    
    return { x, y };
  }

  private buildTexture(name: string) {
    if (this.textureMap.has(name)) return;
    
    const texDef = this.wad.textures.get(name);
    if (!texDef) {
      console.warn(`Texture not found: ${name}`);
      return;
    }

    const { x, y } = this.allocateRect(texDef.width, texDef.height);
    
    // Composite patches
    for (const pMap of texDef.patches) {
      const patchName = this.wad.pnames[pMap.patchIndex];
      const patch = this.wad.getPatch(patchName);
      if (!patch) continue;

      for (let py = 0; py < patch.height; py++) {
        for (let px = 0; px < patch.width; px++) {
          const srcIdx = (py * patch.width + px) * 4;
          const alpha = patch.data[srcIdx + 3];
          if (alpha === 0) continue; // transparent

          const destX = x + pMap.originX + px;
          const destY = y + pMap.originY + py;
          
          if (destX >= x && destX < x + texDef.width &&
              destY >= y && destY < y + texDef.height) {
            const destIdx = (destY * this.atlasWidth + destX) * 4;
            this.atlasData[destIdx] = patch.data[srcIdx];
            this.atlasData[destIdx + 1] = patch.data[srcIdx + 1];
            this.atlasData[destIdx + 2] = patch.data[srcIdx + 2];
            this.atlasData[destIdx + 3] = alpha;
          }
        }
      }
    }

    // Check opacity
    let isOpaque = true;
    for (let py = 0; py < texDef.height; py++) {
      for (let px = 0; px < texDef.width; px++) {
        const idx = ((y + py) * this.atlasWidth + (x + px)) * 4;
        if (this.atlasData[idx + 3] < 255) {
          isOpaque = false;
          break;
        }
      }
      if (!isOpaque) break;
    }

    this.textureMap.set(name, {
      u: x / this.atlasWidth,
      v: y / this.atlasHeight,
      w: texDef.width / this.atlasWidth,
      h: texDef.height / this.atlasHeight,
      width: texDef.width,
      height: texDef.height,
      isOpaque
    });
  }

  private buildFlat(name: string) {
    if (this.textureMap.has(name)) return;
    
    const flat = this.wad.getFlat(name);
    if (!flat) {
      console.warn(`Flat not found: ${name}`);
      return;
    }

    const { x, y } = this.allocateRect(flat.width, flat.height);
    
    for (let py = 0; py < flat.height; py++) {
      for (let px = 0; px < flat.width; px++) {
        const srcIdx = (py * flat.width + px) * 4;
        const destIdx = ((y + py) * this.atlasWidth + (x + px)) * 4;
        this.atlasData[destIdx] = flat.data[srcIdx];
        this.atlasData[destIdx + 1] = flat.data[srcIdx + 1];
        this.atlasData[destIdx + 2] = flat.data[srcIdx + 2];
        this.atlasData[destIdx + 3] = flat.data[srcIdx + 3];
      }
    }

    // Flats are always opaque in Doom
    this.textureMap.set(name, {
      u: x / this.atlasWidth,
      v: y / this.atlasHeight,
      w: flat.width / this.atlasWidth,
      h: flat.height / this.atlasHeight,
      width: flat.width,
      height: flat.height,
      isOpaque: true
    });
  }
}
