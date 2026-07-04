import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

const pX = 3008;
const pZ = -4680;
const dirX = 0;
const dirZ = 1;
const reach = 64.0;
const endX = pX + dirX * reach;
const endZ = pZ + dirZ * reach;

let closestDist = reach;
let hitLinedef = null;

for (let i = 0; i < mapData.linedefs.length; i++) {
  const line = mapData.linedefs[i];
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
    if (line.special > 0 || line.sidenum[1] === -1) {
        if (dist < closestDist) {
          closestDist = dist;
          hitLinedef = { ...line, index: i };
        }
    }
  }
}

console.log("Raycast hit:", hitLinedef ? hitLinedef.index : "Nothing", hitLinedef ? `Special: ${hitLinedef.special}` : "");

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

  console.log(`lowestNeighbor: ${lowestNeighbor}, sector ceiling: ${sector.ceilingheight}`);
  if (lowestNeighbor > sector.ceilingheight && lowestNeighbor !== Infinity) {
    console.log("Door opened successfully.");
  } else {
    console.log("Door failed to open due to height constraints.");
  }
} else {
  console.log("Not a valid door line.");
}
