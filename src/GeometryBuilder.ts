import earcut from 'earcut';
import type { MapData } from './WadParser.ts';
import type { TextureAtlasBuilder, AtlasRect } from './TextureAtlasBuilder.ts';

export interface Triangle {
  v0: [number, number, number];
  v1: [number, number, number];
  v2: [number, number, number];
  normal: [number, number, number];
  materialIndex: number;
  uv0: [number, number];
  uv1: [number, number];
  uv2: [number, number];
  emissivity: number;
  emissionExp: number;
  specularity: number;
  polygonId: string;
}

export interface MaterialDef {
  atlas: AtlasRect;
}

export class GeometryBuilder {
  triangles: Triangle[] = [];
  materials: MaterialDef[] = [];
  private map: MapData;
  private atlas: TextureAtlasBuilder;

  constructor(map: MapData, atlas: TextureAtlasBuilder) {
    this.map = map;
    this.atlas = atlas;
  }

  private getMaterialIndex(texName: string): number {
    if (texName === '-') return 0;
    const rect = this.atlas.textureMap.get(texName);
    if (!rect) return 0;

    let idx = this.materials.findIndex(m => m.atlas === rect);
    if (idx === -1) {
      idx = this.materials.length;
      this.materials.push({ atlas: rect });
    }
    return idx;
  }

  public build() {
    // Add a dummy material for missing textures
    this.materials.push({ atlas: { u: 0, v: 0, w: 1, h: 1, width: 64, height: 64, isOpaque: true } });

    this.buildWalls();
    this.buildFloorsAndCeilings();
    return { triangles: this.triangles, materials: this.materials };
  }

  private addQuad(
    v0: [number, number, number], uv0: [number, number],
    v1: [number, number, number], uv1: [number, number],
    v2: [number, number, number], uv2: [number, number],
    v3: [number, number, number], uv3: [number, number],
    materialIndex: number,
    baseId: string
  ) {
    // Normal calculation from v0, v1, v2
    const ax = v1[0] - v0[0];
    const ay = v1[1] - v0[1];
    const az = v1[2] - v0[2];
    const bx = v2[0] - v0[0];
    const by = v2[1] - v0[1];
    const bz = v2[2] - v0[2];

    let nx = -(ay * bz - az * by);
    let ny = -(az * bx - ax * bz);
    let nz = -(ax * by - ay * bx);

    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len; ny /= len; nz /= len;
    }

    const normal: [number, number, number] = [nx, ny, nz];

    this.triangles.push({ v0, v1, v2, normal, materialIndex, uv0, uv1, uv2, emissivity: 0.0, emissionExp: 0.0, specularity: 0.0, polygonId: `${baseId}_tri_0` });
    this.triangles.push({ v0, v1: v2, v2: v3, normal, materialIndex, uv0, uv1: uv2, uv2: uv3, emissivity: 0.0, emissionExp: 0.0, specularity: 0.0, polygonId: `${baseId}_tri_1` });
  }

  private buildWalls() {
    for (let i = 0; i < this.map.linedefs.length; i++) {
      const linedef = this.map.linedefs[i];
      const v1 = this.map.vertexes[linedef.v1];
      const v2 = this.map.vertexes[linedef.v2];
      const length = Math.hypot(v2.x - v1.x, v2.y - v1.y);

      const rightSide = linedef.sidenum[0] !== -1 ? this.map.sidedefs[linedef.sidenum[0]] : null;
      const leftSide = linedef.sidenum[1] !== -1 ? this.map.sidedefs[linedef.sidenum[1]] : null;

      if (rightSide && !leftSide) {
        // Solid wall
        const sector = this.map.sectors[rightSide.sector];
        const midMat = this.getMaterialIndex(rightSide.midtexture);
        
        const yTop = sector.ceilingheight;
        const yBot = sector.floorheight;
        const u0 = rightSide.textureoffset;
        const u1 = rightSide.textureoffset + length;
        const v0 = rightSide.rowoffset;
        const v1_uv = rightSide.rowoffset + (yTop - yBot);

        this.addQuad(
          [v1.x, yBot, v1.y], [u0, v1_uv],
          [v2.x, yBot, v2.y], [u1, v1_uv],
          [v2.x, yTop, v2.y], [u1, v0],
          [v1.x, yTop, v1.y], [u0, v0],
          midMat,
          `linedef_${i}_mid`
        );
      } else if (rightSide && leftSide) {
        // Portal
        const frontSec = this.map.sectors[rightSide.sector];
        const backSec = this.map.sectors[leftSide.sector];

        // Lower wall
        if (frontSec.floorheight < backSec.floorheight && rightSide.bottomtexture !== '-') {
          const mat = this.getMaterialIndex(rightSide.bottomtexture);
          const yTop = backSec.floorheight;
          const yBot = frontSec.floorheight;
          const u0 = rightSide.textureoffset;
          const u1 = rightSide.textureoffset + length;
          const v0 = rightSide.rowoffset;
          const v1_uv = rightSide.rowoffset + (yTop - yBot);
          
          this.addQuad(
            [v1.x, yBot, v1.y], [u0, v1_uv],
            [v2.x, yBot, v2.y], [u1, v1_uv],
            [v2.x, yTop, v2.y], [u1, v0],
            [v1.x, yTop, v1.y], [u0, v0],
            mat,
            `linedef_${i}_lower_front`
          );
        } else if (backSec.floorheight < frontSec.floorheight && leftSide.bottomtexture !== '-') {
          const mat = this.getMaterialIndex(leftSide.bottomtexture);
          const yTop = frontSec.floorheight;
          const yBot = backSec.floorheight;
          const u0 = leftSide.textureoffset;
          const u1 = leftSide.textureoffset + length;
          const v0 = leftSide.rowoffset;
          const v1_uv = leftSide.rowoffset + (yTop - yBot);

          this.addQuad(
            [v2.x, yBot, v2.y], [u1, v1_uv],
            [v1.x, yBot, v1.y], [u0, v1_uv],
            [v1.x, yTop, v1.y], [u0, v0],
            [v2.x, yTop, v2.y], [u1, v0],
            mat,
            `linedef_${i}_lower_back`
          );
        }

        // Upper wall
        if (frontSec.ceilingheight > backSec.ceilingheight && rightSide.toptexture !== '-') {
          const mat = this.getMaterialIndex(rightSide.toptexture);
          const yTop = frontSec.ceilingheight;
          const yBot = backSec.ceilingheight;
          const u0 = rightSide.textureoffset;
          const u1 = rightSide.textureoffset + length;
          const v0 = rightSide.rowoffset;
          const v1_uv = rightSide.rowoffset + (yTop - yBot);
          
          this.addQuad(
            [v1.x, yBot, v1.y], [u0, v1_uv],
            [v2.x, yBot, v2.y], [u1, v1_uv],
            [v2.x, yTop, v2.y], [u1, v0],
            [v1.x, yTop, v1.y], [u0, v0],
            mat,
            `linedef_${i}_upper_front`
          );
        } else if (backSec.ceilingheight > frontSec.ceilingheight && leftSide.toptexture !== '-') {
          const mat = this.getMaterialIndex(leftSide.toptexture);
          const yTop = backSec.ceilingheight;
          const yBot = frontSec.ceilingheight;
          const u0 = leftSide.textureoffset;
          const u1 = leftSide.textureoffset + length;
          const v0 = leftSide.rowoffset;
          const v1_uv = leftSide.rowoffset + (yTop - yBot);

          this.addQuad(
            [v2.x, yBot, v2.y], [u1, v1_uv],
            [v1.x, yBot, v1.y], [u0, v1_uv],
            [v1.x, yTop, v1.y], [u0, v0],
            [v2.x, yTop, v2.y], [u1, v0],
            mat,
            `linedef_${i}_upper_back`
          );
        }
      }
    }
  }

  private buildFloorsAndCeilings() {
    const sectorLines: { [sectorIdx: number]: { v1: number, v2: number }[] } = {};
    for (const linedef of this.map.linedefs) {
      if (linedef.sidenum[0] !== -1) {
        const sectorIdx = this.map.sidedefs[linedef.sidenum[0]].sector;
        if (!sectorLines[sectorIdx]) sectorLines[sectorIdx] = [];
        sectorLines[sectorIdx].push({ v1: linedef.v1, v2: linedef.v2 });
      }
      if (linedef.sidenum[1] !== -1) {
        const sectorIdx = this.map.sidedefs[linedef.sidenum[1]].sector;
        if (!sectorLines[sectorIdx]) sectorLines[sectorIdx] = [];
        sectorLines[sectorIdx].push({ v1: linedef.v2, v2: linedef.v1 });
      }
    }

    for (let i = 0; i < this.map.sectors.length; i++) {
      const lines = sectorLines[i];
      if (!lines) continue;

      const sector = this.map.sectors[i];
      const floorMat = this.getMaterialIndex(sector.floorpic);
      const ceilMat = this.getMaterialIndex(sector.ceilingpic);
      
      const loops: number[][] = [];
      const used = new Set<number>();
      
      while (used.size < lines.length) {
        let currentLineIdx = -1;
        for (let j = 0; j < lines.length; j++) {
          if (!used.has(j)) { currentLineIdx = j; break; }
        }
        if (currentLineIdx === -1) break;

        const loop: number[] = [];
        let currV = lines[currentLineIdx].v1;
        
        while (true) {
          let found = false;
          for (let j = 0; j < lines.length; j++) {
            if (!used.has(j) && lines[j].v1 === currV) {
              used.add(j);
              loop.push(currV);
              currV = lines[j].v2;
              found = true;
              break;
            }
          }
          if (!found) break; 
          if (loop.length > 0 && currV === loop[0]) break;
        }
        if (loop.length >= 3) loops.push(loop);
      }

      const vertices: number[] = [];
      const holeIndices: number[] = [];
      let offset = 0;
      
      for (let l = 0; l < loops.length; l++) {
        if (l > 0) holeIndices.push(offset / 2);
        for (const vIdx of loops[l]) {
          const v = this.map.vertexes[vIdx];
          vertices.push(v.x, v.y);
          offset += 2;
        }
      }

      const triangles = earcut(vertices, holeIndices);
      
      for (let t = 0; t < triangles.length; t += 3) {
        const i0 = triangles[t] * 2;
        const i1 = triangles[t+1] * 2;
        const i2 = triangles[t+2] * 2;
        
        const u0 = vertices[i0]; const v0 = vertices[i0+1];
        const u1 = vertices[i1]; const v1 = vertices[i1+1];
        const u2 = vertices[i2]; const v2 = vertices[i2+1];

        const v0f: [number, number, number] = [vertices[i0], sector.floorheight, vertices[i0+1]];
        const v1f: [number, number, number] = [vertices[i1], sector.floorheight, vertices[i1+1]];
        const v2f: [number, number, number] = [vertices[i2], sector.floorheight, vertices[i2+1]];
        
        this.triangles.push({ 
          v0: v2f, v1: v1f, v2: v0f, 
          normal: [0, 1, 0], materialIndex: floorMat,
          uv0: [u2, v2], uv1: [u1, v1], uv2: [u0, v0],
          emissivity: 0.0, emissionExp: 0.0, specularity: 0.0,
          polygonId: `sector_${i}_floor_tri_${t}`
        });

        const v0c: [number, number, number] = [vertices[i0], sector.ceilingheight, vertices[i0+1]];
        const v1c: [number, number, number] = [vertices[i1], sector.ceilingheight, vertices[i1+1]];
        const v2c: [number, number, number] = [vertices[i2], sector.ceilingheight, vertices[i2+1]];
        
        if (sector.ceilingpic !== 'F_SKY1') {
          this.triangles.push({ 
            v0: v0c, v1: v1c, v2: v2c, 
            normal: [0, -1, 0], materialIndex: ceilMat,
            uv0: [u0, v0], uv1: [u1, v1], uv2: [u2, v2],
            emissivity: 0.0, emissionExp: 0.0, specularity: 0.0,
            polygonId: `sector_${i}_ceil_tri_${t}`
          });
        }
      }
    }
  }
}
