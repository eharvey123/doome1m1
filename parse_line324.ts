import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

const l = mapData.linedefs[324];
console.log(`Linedef 324 special: ${l.special}`);
if (l.sidenum[0] !== -1) {
    const side = mapData.sidedefs[l.sidenum[0]];
    const sector = mapData.sectors[side.sector];
    console.log(`Front side (sidenum[0]) sector: ${side.sector}, ceilingheight: ${sector.ceilingheight}`);
}
if (l.sidenum[1] !== -1) {
    const side = mapData.sidedefs[l.sidenum[1]];
    const sector = mapData.sectors[side.sector];
    console.log(`Back side (sidenum[1]) sector: ${side.sector}, ceilingheight: ${sector.ceilingheight}`);
}
