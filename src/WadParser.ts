export interface WadHeader {
  identification: string;
  numlumps: number;
  infotableofs: number;
}

export interface Lump {
  filepos: number;
  size: number;
  name: string;
}

export interface Vertex {
  x: number;
  y: number;
}

export interface Sidedef {
  textureoffset: number;
  rowoffset: number;
  toptexture: string;
  bottomtexture: string;
  midtexture: string;
  sector: number;
}

export interface Linedef {
  v1: number;
  v2: number;
  flags: number;
  special: number;
  tag: number;
  sidenum: [number, number];
}

export interface Sector {
  floorheight: number;
  ceilingheight: number;
  floorpic: string;
  ceilingpic: string;
  lightlevel: number;
  special: number;
  tag: number;
}

export interface MapData {
  name: string;
  vertexes: Vertex[];
  linedefs: Linedef[];
  sidedefs: Sidedef[];
  sectors: Sector[];
}

export interface PatchMap {
  originX: number;
  originY: number;
  patchIndex: number;
}

export interface TextureDef {
  name: string;
  width: number;
  height: number;
  patches: PatchMap[];
}

export class WadParser {
  buffer: ArrayBuffer;
  view: DataView;
  header!: WadHeader;
  lumps: Lump[] = [];
  
  // Parsed globals
  playpal: Uint8Array[] = []; // Array of [r,g,b]
  pnames: string[] = [];
  textures: Map<string, TextureDef> = new Map();

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.parseHeader();
    this.parseDirectory();
    this.parsePlaypal();
    this.parsePnames();
    this.parseTextures('TEXTURE1');
    if (this.findLumpIndex('TEXTURE2') !== -1) {
      this.parseTextures('TEXTURE2');
    }
  }

  private readString(offset: number, length: number): string {
    let str = '';
    for (let i = 0; i < length; i++) {
      const charCode = this.view.getUint8(offset + i);
      if (charCode === 0) break;
      str += String.fromCharCode(charCode);
    }
    return str.toUpperCase();
  }

  private parseHeader() {
    this.header = {
      identification: this.readString(0, 4),
      numlumps: this.view.getInt32(4, true),
      infotableofs: this.view.getInt32(8, true)
    };
  }

  private parseDirectory() {
    let offset = this.header.infotableofs;
    for (let i = 0; i < this.header.numlumps; i++) {
      this.lumps.push({
        filepos: this.view.getInt32(offset, true),
        size: this.view.getInt32(offset + 4, true),
        name: this.readString(offset + 8, 8)
      });
      offset += 16;
    }
  }

  public findLumpIndex(name: string): number {
    return this.lumps.findIndex(l => l.name === name.toUpperCase());
  }

  // ==== TEXTURE PARSING ====

  private parsePlaypal() {
    const idx = this.findLumpIndex('PLAYPAL');
    if (idx === -1) return;
    const lump = this.lumps[idx];
    let offset = lump.filepos;
    for (let i = 0; i < 256; i++) {
      this.playpal.push(new Uint8Array([
        this.view.getUint8(offset++),
        this.view.getUint8(offset++),
        this.view.getUint8(offset++)
      ]));
    }
  }

  private parsePnames() {
    const idx = this.findLumpIndex('PNAMES');
    if (idx === -1) return;
    const lump = this.lumps[idx];
    const numPnames = this.view.getUint32(lump.filepos, true);
    let offset = lump.filepos + 4;
    for (let i = 0; i < numPnames; i++) {
      this.pnames.push(this.readString(offset, 8));
      offset += 8;
    }
  }

  private parseTextures(lumpName: string) {
    const idx = this.findLumpIndex(lumpName);
    if (idx === -1) return;
    const lump = this.lumps[idx];
    const numTextures = this.view.getUint32(lump.filepos, true);
    const offsets: number[] = [];
    let offset = lump.filepos + 4;
    for (let i = 0; i < numTextures; i++) {
      offsets.push(this.view.getUint32(offset, true));
      offset += 4;
    }

    for (let i = 0; i < numTextures; i++) {
      let tOffset = lump.filepos + offsets[i];
      const name = this.readString(tOffset, 8);
      tOffset += 12; // skip name and masked
      const width = this.view.getUint16(tOffset, true);
      const height = this.view.getUint16(tOffset + 2, true);
      tOffset += 8; // skip width, height, columndirectory
      const patchCount = this.view.getUint16(tOffset, true);
      tOffset += 2;

      const patches: PatchMap[] = [];
      for (let p = 0; p < patchCount; p++) {
        patches.push({
          originX: this.view.getInt16(tOffset, true),
          originY: this.view.getInt16(tOffset + 2, true),
          patchIndex: this.view.getUint16(tOffset + 4, true)
        });
        tOffset += 10;
      }
      this.textures.set(name, { name, width, height, patches });
    }
  }

  public getPatch(name: string): { width: number, height: number, data: Uint8Array } | null {
    const idx = this.findLumpIndex(name);
    if (idx === -1) return null;
    const lump = this.lumps[idx];
    
    let offset = lump.filepos;
    const width = this.view.getUint16(offset, true);
    const height = this.view.getUint16(offset + 2, true);
    offset += 8; // skip width, height, leftoffset, topoffset

    const columnOffsets: number[] = [];
    for (let i = 0; i < width; i++) {
      columnOffsets.push(this.view.getUint32(offset, true));
      offset += 4;
    }

    const rgba = new Uint8Array(width * height * 4);

    for (let x = 0; x < width; x++) {
      let colOffset = lump.filepos + columnOffsets[x];
      while (true) {
        const rowStart = this.view.getUint8(colOffset++);
        if (rowStart === 255) break;
        const count = this.view.getUint8(colOffset++);
        colOffset++; // skip dummy
        for (let i = 0; i < count; i++) {
          const pixelY = rowStart + i;
          const colorIdx = this.view.getUint8(colOffset++);
          if (pixelY < height) {
            const outIdx = (pixelY * width + x) * 4;
            const rgb = this.playpal[colorIdx];
            if (rgb) {
              rgba[outIdx] = rgb[0];
              rgba[outIdx + 1] = rgb[1];
              rgba[outIdx + 2] = rgb[2];
              rgba[outIdx + 3] = 255;
            }
          }
        }
        colOffset++; // skip dummy
      }
    }
    return { width, height, data: rgba };
  }

  public getFlat(name: string): { width: number, height: number, data: Uint8Array } | null {
    const idx = this.findLumpIndex(name);
    if (idx === -1) return null;
    const lump = this.lumps[idx];
    if (lump.size !== 4096) return null; // Flats are exactly 64x64

    const rgba = new Uint8Array(64 * 64 * 4);
    let offset = lump.filepos;
    for (let i = 0; i < 4096; i++) {
      const colorIdx = this.view.getUint8(offset++);
      const rgb = this.playpal[colorIdx];
      const outIdx = i * 4;
      if (rgb) {
        rgba[outIdx] = rgb[0];
        rgba[outIdx + 1] = rgb[1];
        rgba[outIdx + 2] = rgb[2];
        rgba[outIdx + 3] = 255;
      }
    }
    return { width: 64, height: 64, data: rgba };
  }

  // ==== MAP PARSING ====

  public parseMap(mapName: string): MapData {
    const mapIndex = this.findLumpIndex(mapName);
    if (mapIndex === -1) throw new Error(`Map ${mapName} not found`);

    return {
      name: mapName,
      vertexes: this.parseVertexes(mapIndex + 4),
      linedefs: this.parseLinedefs(mapIndex + 2),
      sidedefs: this.parseSidedefs(mapIndex + 3),
      sectors: this.parseSectors(mapIndex + 8)
    };
  }

  private parseVertexes(lumpIndex: number): Vertex[] {
    const lump = this.lumps[lumpIndex];
    const count = lump.size / 4;
    const vertexes: Vertex[] = [];
    let offset = lump.filepos;
    for (let i = 0; i < count; i++) {
      vertexes.push({
        x: this.view.getInt16(offset, true),
        y: this.view.getInt16(offset + 2, true)
      });
      offset += 4;
    }
    return vertexes;
  }

  private parseLinedefs(lumpIndex: number): Linedef[] {
    const lump = this.lumps[lumpIndex];
    const count = lump.size / 14;
    const linedefs: Linedef[] = [];
    let offset = lump.filepos;
    for (let i = 0; i < count; i++) {
      linedefs.push({
        v1: this.view.getUint16(offset, true),
        v2: this.view.getUint16(offset + 2, true),
        flags: this.view.getUint16(offset + 4, true),
        special: this.view.getUint16(offset + 6, true),
        tag: this.view.getUint16(offset + 8, true),
        sidenum: [
          this.view.getInt16(offset + 10, true),
          this.view.getInt16(offset + 12, true)
        ]
      });
      offset += 14;
    }
    return linedefs;
  }

  private parseSidedefs(lumpIndex: number): Sidedef[] {
    const lump = this.lumps[lumpIndex];
    const count = lump.size / 30;
    const sidedefs: Sidedef[] = [];
    let offset = lump.filepos;
    for (let i = 0; i < count; i++) {
      sidedefs.push({
        textureoffset: this.view.getInt16(offset, true),
        rowoffset: this.view.getInt16(offset + 2, true),
        toptexture: this.readString(offset + 4, 8),
        bottomtexture: this.readString(offset + 12, 8),
        midtexture: this.readString(offset + 20, 8),
        sector: this.view.getUint16(offset + 28, true)
      });
      offset += 30;
    }
    return sidedefs;
  }

  private parseSectors(lumpIndex: number): Sector[] {
    const lump = this.lumps[lumpIndex];
    const count = lump.size / 26;
    const sectors: Sector[] = [];
    let offset = lump.filepos;
    for (let i = 0; i < count; i++) {
      sectors.push({
        floorheight: this.view.getInt16(offset, true),
        ceilingheight: this.view.getInt16(offset + 2, true),
        floorpic: this.readString(offset + 4, 8),
        ceilingpic: this.readString(offset + 12, 8),
        lightlevel: this.view.getUint16(offset + 20, true),
        special: this.view.getUint16(offset + 22, true),
        tag: this.view.getUint16(offset + 24, true)
      });
      offset += 26;
    }
    return sectors;
  }
}
