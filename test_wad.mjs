import fs from 'fs';

import { WadParser } from './src/WadParser.ts';
import { GeometryBuilder } from './src/GeometryBuilder.ts';
import { BvhBuilder } from './src/BvhBuilder.ts';

const buffer = fs.readFileSync('public/DOOM1.WAD').buffer.slice(
  fs.readFileSync('public/DOOM1.WAD').byteOffset, 
  fs.readFileSync('public/DOOM1.WAD').byteOffset + fs.readFileSync('public/DOOM1.WAD').byteLength
);
const wad = new WadParser(buffer);
const map = wad.parseMap('E1M1');

const builder = new GeometryBuilder(map);
const triangles = builder.build();
console.log(`Generated ${triangles.length} triangles.`);

const bvhBuilder = new BvhBuilder(triangles);
const bvh = bvhBuilder.build();
console.log(`Generated BVH with ${bvh.nodes.length} nodes for ${bvh.orderedTriangles.length} triangles.`);
