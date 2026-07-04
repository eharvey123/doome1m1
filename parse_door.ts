import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

for (let i = 0; i < mapData.linedefs.length; i++) {
    const line = mapData.linedefs[i];
    if (line.special === 1 && line.sidenum[1] !== -1) {
        const side = mapData.sidedefs[line.sidenum[1]];
        const sector = mapData.sectors[side.sector];
        
        let lowestNeighbor = Infinity;
        for (const l of mapData.linedefs) {
            if (l.sidenum[0] !== -1 && l.sidenum[1] !== -1) {
                const sec0 = mapData.sidedefs[l.sidenum[0]].sector;
                const sec1 = mapData.sidedefs[l.sidenum[1]].sector;
                if (sec0 === side.sector) lowestNeighbor = Math.min(lowestNeighbor, mapData.sectors[sec1].ceilingheight);
                if (sec1 === side.sector) lowestNeighbor = Math.min(lowestNeighbor, mapData.sectors[sec0].ceilingheight);
            }
        }
        if (!(lowestNeighbor > sector.ceilingheight && lowestNeighbor !== Infinity)) {
            console.log(`Door will NOT open! Linedef index: ${i}, sector ceiling: ${sector.ceilingheight}, lowestNeighbor: ${lowestNeighbor}`);
        }
    }
}
