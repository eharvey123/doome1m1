import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

const l = mapData.linedefs[324];
const side = mapData.sidedefs[l.sidenum[1]];
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
console.log(`Door sector ceiling: ${sector.ceilingheight}`);
console.log(`lowestNeighbor: ${lowestNeighbor}`);
if (lowestNeighbor > sector.ceilingheight && lowestNeighbor !== Infinity) {
    console.log("Will open!");
} else {
    console.log("Will NOT open!");
}
