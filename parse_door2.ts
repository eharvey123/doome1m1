import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

for (let i = 0; i < mapData.linedefs.length; i++) {
    const line = mapData.linedefs[i];
    if (line.special > 0 && line.special !== 1) {
        console.log(`Linedef index ${i} has special ${line.special}`);
    }
}
