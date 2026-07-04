import fs from 'fs';
import { WadParser } from './src/WadParser.ts';

const wadData = fs.readFileSync('./public/DOOM1.WAD');
const wad = new WadParser(wadData.buffer);
const mapData = wad.parseMap('E1M1');

const l = mapData.linedefs[333];
console.log(`Linedef 333: v1: (${mapData.vertexes[l.v1].x}, ${mapData.vertexes[l.v1].y}), v2: (${mapData.vertexes[l.v2].x}, ${mapData.vertexes[l.v2].y})`);
