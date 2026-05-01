// graph overview
import { KdTree } from './kd-tree';

export interface KnnGraph {
  k: number;
  neighborIndices: Uint32Array;
  meanEdgeLength: number;
}

export function buildKnnGraph(
  _positions: Float32Array,
  count: number,
  tree: KdTree,
  k: number,
): KnnGraph {
  const neighborIndices = new Uint32Array(count * k);
  let totalEdgeLength = 0;
  let totalEdgeCount = 0;

  for (let i = 0; i < count; i++) {
    const { indices, distances } = tree.kNearest(i, k);
    const base = i * k;

    for (let j = 0; j < k; j++) {
      if (j < indices.length) {
        neighborIndices[base + j] = indices[j];
        const d = distances[j];
        if (d > 0) {
          totalEdgeLength += d;
          totalEdgeCount++;
        }
      } else {
        
        
        neighborIndices[base + j] = i;
      }
    }
  }

  const meanEdgeLength = totalEdgeCount > 0 ? totalEdgeLength / totalEdgeCount : 1;
  return { k, neighborIndices, meanEdgeLength };
}
