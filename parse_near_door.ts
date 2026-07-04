import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

const doorLinedef = mapData.linedefs[320]; // 2976, -4648 -> 3040, -4648
const doorSide = mapData.sidedefs[doorLinedef.sidenum[0]];
const frontSectorIdx = doorSide.sector;

console.log("Lines in front sector:");
for (let i = 0; i < mapData.linedefs.length; i++) {
    const l = mapData.linedefs[i];
    if (l.sidenum[0] !== -1 && mapData.sidedefs[l.sidenum[0]].sector === frontSectorIdx) {
        console.log(`Linedef ${i} front. Special: ${l.special}, v1: ${mapData.vertexes[l.v1].x},${mapData.vertexes[l.v1].y} v2: ${mapData.vertexes[l.v2].x},${mapData.vertexes[l.v2].y}`);
    }
    if (l.sidenum[1] !== -1 && mapData.sidedefs[l.sidenum[1]].sector === frontSectorIdx) {
        console.log(`Linedef ${i} back. Special: ${l.special}, v1: ${mapData.vertexes[l.v1].x},${mapData.vertexes[l.v1].y} v2: ${mapData.vertexes[l.v2].x},${mapData.vertexes[l.v2].y}`);
    }
}
