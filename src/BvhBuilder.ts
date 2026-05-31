import type { Triangle } from './GeometryBuilder.ts';

export interface BvhNode {
  aabbMin: [number, number, number];
  leftFirst: number; // For leaves: first triangle index. For inner: left child node index.
  aabbMax: [number, number, number];
  triCount: number; // For leaves: number of triangles. For inner: 0.
}

export class BvhBuilder {
  private nodes: BvhNode[] = [];
  private triangles: Triangle[];
  private triIndices: number[];
  private centroids: [number, number, number][] = [];
  private nodesUsed = 1; // Node 0 is root

  constructor(triangles: Triangle[]) {
    this.triangles = triangles;
    this.triIndices = new Array(triangles.length);
    for (let i = 0; i < triangles.length; i++) {
      this.triIndices[i] = i;
      const t = triangles[i];
      this.centroids.push([
        (t.v0[0] + t.v1[0] + t.v2[0]) / 3,
        (t.v0[1] + t.v1[1] + t.v2[1]) / 3,
        (t.v0[2] + t.v1[2] + t.v2[2]) / 3,
      ]);
    }
    
    // Pre-allocate node array to max possible nodes (2n-1)
    for (let i = 0; i < triangles.length * 2 - 1; i++) {
      this.nodes.push({
        aabbMin: [0, 0, 0],
        aabbMax: [0, 0, 0],
        leftFirst: 0,
        triCount: 0
      });
    }
  }

  public build(): { nodes: BvhNode[], orderedTriangles: Triangle[] } {
    const root = this.nodes[0];
    root.leftFirst = 0;
    root.triCount = this.triangles.length;
    this.updateNodeBounds(0);
    this.subdivide(0);
    
    // Trim unused nodes
    this.nodes = this.nodes.slice(0, this.nodesUsed);
    
    // Reorder triangles based on triIndices
    const orderedTriangles: Triangle[] = new Array(this.triangles.length);
    for (let i = 0; i < this.triangles.length; i++) {
      orderedTriangles[i] = this.triangles[this.triIndices[i]];
    }

    return { nodes: this.nodes, orderedTriangles };
  }

  private updateNodeBounds(nodeIdx: number) {
    const node = this.nodes[nodeIdx];
    node.aabbMin = [Infinity, Infinity, Infinity];
    node.aabbMax = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < node.triCount; i++) {
      const leafTriIdx = this.triIndices[node.leftFirst + i];
      const tri = this.triangles[leafTriIdx];
      
      for (let j = 0; j < 3; j++) {
        node.aabbMin[0] = Math.min(node.aabbMin[0], tri.v0[0], tri.v1[0], tri.v2[0]);
        node.aabbMin[1] = Math.min(node.aabbMin[1], tri.v0[1], tri.v1[1], tri.v2[1]);
        node.aabbMin[2] = Math.min(node.aabbMin[2], tri.v0[2], tri.v1[2], tri.v2[2]);

        node.aabbMax[0] = Math.max(node.aabbMax[0], tri.v0[0], tri.v1[0], tri.v2[0]);
        node.aabbMax[1] = Math.max(node.aabbMax[1], tri.v0[1], tri.v1[1], tri.v2[1]);
        node.aabbMax[2] = Math.max(node.aabbMax[2], tri.v0[2], tri.v1[2], tri.v2[2]);
      }
    }
  }

  private calculateSurfaceArea(min: [number, number, number], max: [number, number, number]): number {
    const ex = Math.max(0, max[0] - min[0]);
    const ey = Math.max(0, max[1] - min[1]);
    const ez = Math.max(0, max[2] - min[2]);
    return 2 * (ex * ey + ey * ez + ez * ex);
  }

  private subdivide(nodeIdx: number) {
    const node = this.nodes[nodeIdx];
    if (node.triCount <= 2) return; // Leaf node threshold

    let bestAxis = -1;
    let bestSplitPos = 0;
    let bestCost = 1e30;

    const BINS = 8;
    for (let axis = 0; axis < 3; axis++) {
      let boundsMin = Infinity;
      let boundsMax = -Infinity;
      for (let i = 0; i < node.triCount; i++) {
        const centroid = this.centroids[this.triIndices[node.leftFirst + i]][axis];
        boundsMin = Math.min(boundsMin, centroid);
        boundsMax = Math.max(boundsMax, centroid);
      }
      
      if (boundsMin === boundsMax) continue;

      const scale = BINS / (boundsMax - boundsMin);
      
      const binCounts = new Array(BINS).fill(0);
      const binBoundsMin = Array.from({length: BINS}, () => [Infinity, Infinity, Infinity]);
      const binBoundsMax = Array.from({length: BINS}, () => [-Infinity, -Infinity, -Infinity]);

      for (let i = 0; i < node.triCount; i++) {
        const triIdx = this.triIndices[node.leftFirst + i];
        const centroid = this.centroids[triIdx][axis];
        let binIdx = Math.floor((centroid - boundsMin) * scale);
        binIdx = Math.min(BINS - 1, Math.max(0, binIdx));
        
        binCounts[binIdx]++;
        const tri = this.triangles[triIdx];
        
        for (let j = 0; j < 3; j++) {
            binBoundsMin[binIdx][j] = Math.min(binBoundsMin[binIdx][j], tri.v0[j], tri.v1[j], tri.v2[j]);
            binBoundsMax[binIdx][j] = Math.max(binBoundsMax[binIdx][j], tri.v0[j], tri.v1[j], tri.v2[j]);
        }
      }

      const leftArea = new Array(BINS - 1);
      const leftCount = new Array(BINS - 1);
      let leftBoxMin = [Infinity, Infinity, Infinity];
      let leftBoxMax = [-Infinity, -Infinity, -Infinity];
      let leftSum = 0;

      for (let i = 0; i < BINS - 1; i++) {
        leftSum += binCounts[i];
        leftCount[i] = leftSum;
        for (let j = 0; j < 3; j++) {
            leftBoxMin[j] = Math.min(leftBoxMin[j], binBoundsMin[i][j]);
            leftBoxMax[j] = Math.max(leftBoxMax[j], binBoundsMax[i][j]);
        }
        leftArea[i] = this.calculateSurfaceArea(leftBoxMin as [number,number,number], leftBoxMax as [number,number,number]);
      }

      let rightBoxMin = [Infinity, Infinity, Infinity];
      let rightBoxMax = [-Infinity, -Infinity, -Infinity];
      let rightSum = 0;

      for (let i = BINS - 2; i >= 0; i--) {
        rightSum += binCounts[i + 1];
        for (let j = 0; j < 3; j++) {
            rightBoxMin[j] = Math.min(rightBoxMin[j], binBoundsMin[i + 1][j]);
            rightBoxMax[j] = Math.max(rightBoxMax[j], binBoundsMax[i + 1][j]);
        }
        const rightArea = this.calculateSurfaceArea(rightBoxMin as [number,number,number], rightBoxMax as [number,number,number]);
        
        const cost = leftCount[i] * leftArea[i] + rightSum * rightArea;
        if (cost < bestCost) {
            bestCost = cost;
            bestAxis = axis;
            bestSplitPos = boundsMin + (i + 1) / scale;
        }
      }
    }

    const currentArea = this.calculateSurfaceArea(node.aabbMin, node.aabbMax);
    const currentCost = node.triCount * currentArea;

    if (bestCost >= currentCost || bestAxis === -1) {
        return; // SAH says splitting makes it worse!
    }

    // Now partition based on bestAxis and bestSplitPos
    let i = node.leftFirst;
    let j = i + node.triCount - 1;
    while (i <= j) {
      if (this.centroids[this.triIndices[i]][bestAxis] < bestSplitPos) {
        i++;
      } else {
        const temp = this.triIndices[i];
        this.triIndices[i] = this.triIndices[j];
        this.triIndices[j] = temp;
        j--;
      }
    }

    const leftCount = i - node.leftFirst;
    if (leftCount === 0 || leftCount === node.triCount) return; // Fallback if splitting fails

    const leftChildIdx = this.nodesUsed++;
    const rightChildIdx = this.nodesUsed++;

    this.nodes[leftChildIdx].leftFirst = node.leftFirst;
    this.nodes[leftChildIdx].triCount = leftCount;
    this.updateNodeBounds(leftChildIdx);

    this.nodes[rightChildIdx].leftFirst = i;
    this.nodes[rightChildIdx].triCount = node.triCount - leftCount;
    this.updateNodeBounds(rightChildIdx);

    node.leftFirst = leftChildIdx;
    node.triCount = 0; // Inner node

    this.subdivide(leftChildIdx);
    this.subdivide(rightChildIdx);
  }
}
