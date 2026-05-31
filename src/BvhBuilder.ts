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

  private subdivide(nodeIdx: number) {
    const node = this.nodes[nodeIdx];
    if (node.triCount <= 2) return; // Leaf node threshold

    // Find longest axis of the bounding box
    const extent = [
      node.aabbMax[0] - node.aabbMin[0],
      node.aabbMax[1] - node.aabbMin[1],
      node.aabbMax[2] - node.aabbMin[2]
    ];
    
    let axis = 0;
    if (extent[1] > extent[0]) axis = 1;
    if (extent[2] > extent[axis]) axis = 2;

    // Split at the median of centroids
    const splitPos = node.aabbMin[axis] + extent[axis] * 0.5;

    let i = node.leftFirst;
    let j = i + node.triCount - 1;
    while (i <= j) {
      if (this.centroids[this.triIndices[i]][axis] < splitPos) {
        i++;
      } else {
        // Swap i and j
        const temp = this.triIndices[i];
        this.triIndices[i] = this.triIndices[j];
        this.triIndices[j] = temp;
        j--;
      }
    }

    const leftCount = i - node.leftFirst;
    if (leftCount === 0 || leftCount === node.triCount) return; // Cannot split

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
