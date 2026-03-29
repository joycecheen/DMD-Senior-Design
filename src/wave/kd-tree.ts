// k-d tree for 3D k-nearest queries (graph build).

interface KdNode {
  splitAxis: number;   // 0=x, 1=y, 2=z
  splitValue: number;
  left: KdNode | null;
  right: KdNode | null;
  indices: number[] | null; // leaf node point indices
}

const LEAF_SIZE = 16;

export class KdTree {
  private root: KdNode;
  private positions: Float32Array;

  constructor(positions: Float32Array, count: number) {
    this.positions = positions;

    const allIndices = new Array(count);
    for (let i = 0; i < count; i++) allIndices[i] = i;
    this.root = this.build(allIndices);
  }

  private build(indices: number[]): KdNode {
    if (indices.length <= LEAF_SIZE) {
      return { splitAxis: 0, splitValue: 0, left: null, right: null, indices };
    }

    let bestAxis = 0;
    let bestExtent = -1;
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity, max = -Infinity;
      for (const idx of indices) {
        const v = this.positions[idx * 3 + axis];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const extent = max - min;
      if (extent > bestExtent) {
        bestExtent = extent;
        bestAxis = axis;
      }
    }

    indices.sort((a, b) =>
      this.positions[a * 3 + bestAxis] - this.positions[b * 3 + bestAxis]
    );
    const mid = indices.length >> 1;
    const splitValue = this.positions[indices[mid] * 3 + bestAxis];

    return {
      splitAxis: bestAxis,
      splitValue,
      left: this.build(indices.slice(0, mid)),
      right: this.build(indices.slice(mid)),
      indices: null,
    };
  }

  kNearest(queryIdx: number, k: number): { indices: number[]; distances: number[] } {
    const qx = this.positions[queryIdx * 3];
    const qy = this.positions[queryIdx * 3 + 1];
    const qz = this.positions[queryIdx * 3 + 2];

    const heap: { dist: number; idx: number }[] = [];
    let maxDist = Infinity;

    const search = (node: KdNode) => {
      if (node.indices !== null) {
        for (const idx of node.indices) {
          if (idx === queryIdx) continue;
          const dx = this.positions[idx * 3] - qx;
          const dy = this.positions[idx * 3 + 1] - qy;
          const dz = this.positions[idx * 3 + 2] - qz;
          const dist = dx * dx + dy * dy + dz * dz;
          if (heap.length < k) {
            heap.push({ dist, idx });
            if (heap.length === k) {
              for (let i = (k >> 1) - 1; i >= 0; i--) this.siftDown(heap, i);
              maxDist = heap[0].dist;
            }
          } else if (dist < maxDist) {
            heap[0] = { dist, idx };
            this.siftDown(heap, 0);
            maxDist = heap[0].dist;
          }
        }
        return;
      }

      const axis = node.splitAxis;
      const query = axis === 0 ? qx : axis === 1 ? qy : qz;
      const diff = query - node.splitValue;

      const near = diff <= 0 ? node.left! : node.right!;
      const far = diff <= 0 ? node.right! : node.left!;

      search(near);

      if (diff * diff < maxDist || heap.length < k) {
        search(far);
      }
    };

    search(this.root);

    heap.sort((a, b) => a.dist - b.dist);
    return {
      indices: heap.map(h => h.idx),
      distances: heap.map(h => Math.sqrt(h.dist)),
    };
  }

  nearest(point: [number, number, number]): number {
    const [qx, qy, qz] = point;
    let bestDist = Infinity;
    let bestIdx = 0;

    const search = (node: KdNode) => {
      if (node.indices !== null) {
        for (const idx of node.indices) {
          const dx = this.positions[idx * 3] - qx;
          const dy = this.positions[idx * 3 + 1] - qy;
          const dz = this.positions[idx * 3 + 2] - qz;
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = idx;
          }
        }
        return;
      }

      const axis = node.splitAxis;
      const query = axis === 0 ? qx : axis === 1 ? qy : qz;
      const diff = query - node.splitValue;

      const near = diff <= 0 ? node.left! : node.right!;
      const far = diff <= 0 ? node.right! : node.left!;

      search(near);
      if (diff * diff < bestDist) search(far);
    };

    search(this.root);
    return bestIdx;
  }

  private siftDown(heap: { dist: number; idx: number }[], i: number): void {
    const n = heap.length;
    while (true) {
      let largest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && heap[l].dist > heap[largest].dist) largest = l;
      if (r < n && heap[r].dist > heap[largest].dist) largest = r;
      if (largest === i) break;
      const tmp = heap[i];
      heap[i] = heap[largest];
      heap[largest] = tmp;
      i = largest;
    }
  }
}
