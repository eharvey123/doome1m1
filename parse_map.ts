import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const map = wad.parseMap('E1M1');

// Find lines with special > 0
for (const line of map.linedefs) {
  if (line.special > 0) {
    const v1 = map.vertexes[line.v1];
    const v2 = map.vertexes[line.v2];
    console.log(`Linedef special ${line.special}, v1: (${v1.x}, ${v1.y}), v2: (${v2.x}, ${v2.y}) sidenum: ${line.sidenum[0]}, ${line.sidenum[1]}`);
  }
}
