// k-nearest graph: neighbor weights, PCA normals, boundary flags (for the wave sim).

import { KdTree } from './kd-tree';

export interface KnnGraph {
  k: number;
  neighborIndices: Uint32Array;
  neighborWeights: Float32Array;
  normals: Float32Array;
  isBoundary: Uint8Array;
  minEdgeLength: number;
  meanEdgeLength: number;
}

export function buildKnnGraph(
  positions: Float32Array,
  count: number,
  tree: KdTree,
  k: number,
): KnnGraph {
  const neighborIndices = new Uint32Array(count * k);
  const neighborWeights = new Float32Array(count * k);
  const normals = new Float32Array(count * 3);
  const isBoundary = new Uint8Array(count);
  let minEdgeLength = Infinity;
  let totalEdgeLength = 0;
  let totalEdgeCount = 0;

  for (let i = 0; i < count; i++) {
    const { indices, distances } = tree.kNearest(i, k);
    const base = i * k;

    let weightSum = 0;
    for (let j = 0; j < k; j++) {
      if (j < indices.length) {
        neighborIndices[base + j] = indices[j];
        const d = distances[j];
        if (d < minEdgeLength && d > 0) minEdgeLength = d;
        if (d > 0) { totalEdgeLength += d; totalEdgeCount++; }
        const w = d > 1e-8 ? 1.0 / d : 0;
        neighborWeights[base + j] = w;
        weightSum += w;
      } else {
        neighborIndices[base + j] = i;
        neighborWeights[base + j] = 0;
      }
    }

    if (weightSum > 0) {
      for (let j = 0; j < k; j++) {
        neighborWeights[base + j] /= weightSum;
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const cx = positions[i * 3];
    const cy = positions[i * 3 + 1];
    const cz = positions[i * 3 + 2];
    const base = i * k;

    let mx = 0, my = 0, mz = 0;
    let validCount = 0;
    for (let j = 0; j < k; j++) {
      const ni = neighborIndices[base + j];
      if (ni === i && j > 0) continue;
      mx += positions[ni * 3];
      my += positions[ni * 3 + 1];
      mz += positions[ni * 3 + 2];
      validCount++;
    }
    mx /= validCount;
    my /= validCount;
    mz /= validCount;

    let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
    for (let j = 0; j < k; j++) {
      const ni = neighborIndices[base + j];
      if (ni === i && j > 0) continue;
      const dx = positions[ni * 3] - mx;
      const dy = positions[ni * 3 + 1] - my;
      const dz = positions[ni * 3 + 2] - mz;
      cxx += dx * dx;
      cxy += dx * dy;
      cxz += dx * dz;
      cyy += dy * dy;
      cyz += dy * dz;
      czz += dz * dz;
    }

    const normal = smallestEigenvector(cxx, cxy, cxz, cyy, cyz, czz);
    normals[i * 3] = normal[0];
    normals[i * 3 + 1] = normal[1];
    normals[i * 3 + 2] = normal[2];

    const dx = mx - cx;
    const dy = my - cy;
    const dz = mz - cz;
    const asymmetry = Math.sqrt(dx * dx + dy * dy + dz * dz);

    let meanEdge = 0;
    let edgeCount = 0;
    for (let j = 0; j < k; j++) {
      const ni = neighborIndices[base + j];
      if (ni === i && j > 0) continue;
      const ex = positions[ni * 3] - cx;
      const ey = positions[ni * 3 + 1] - cy;
      const ez = positions[ni * 3 + 2] - cz;
      meanEdge += Math.sqrt(ex * ex + ey * ey + ez * ez);
      edgeCount++;
    }
    meanEdge /= Math.max(edgeCount, 1);

    if (meanEdge > 0 && asymmetry / meanEdge > 0.4) {
      isBoundary[i] = 1;
    }
  }

  orientNormals(normals, neighborIndices, count, k);

  const meanEdgeLength = totalEdgeCount > 0 ? totalEdgeLength / totalEdgeCount : minEdgeLength;
  return { k, neighborIndices, neighborWeights, normals, isBoundary, minEdgeLength, meanEdgeLength };
}

// Smallest eigenvector of a 3×3 symmetric matrix (Cardano).
function smallestEigenvector(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
): [number, number, number] {
  const p1 = b * b + c * c + e * e;

  if (p1 < 1e-12) {
    const minVal = Math.min(a, d, f);
    if (Math.abs(a - minVal) < 1e-8) return [1, 0, 0];
    if (Math.abs(d - minVal) < 1e-8) return [0, 1, 0];
    return [0, 0, 1];
  }

  const q = (a + d + f) / 3;
  const p2 = (a - q) * (a - q) + (d - q) * (d - q) + (f - q) * (f - q) + 2 * p1;
  const p = Math.sqrt(p2 / 6);

  const b00 = (a - q) / p, b01 = b / p, b02 = c / p;
  const b11 = (d - q) / p, b12 = e / p;
  const b22 = (f - q) / p;

  const detB = b00 * (b11 * b22 - b12 * b12)
             - b01 * (b01 * b22 - b12 * b02)
             + b02 * (b01 * b12 - b11 * b02);

  let r = detB / 2;
  r = Math.max(-1, Math.min(1, r));

  const phi = Math.acos(r) / 3;

  const eig2 = q + 2 * p * Math.cos(phi + (2 * Math.PI / 3));

  return nullSpaceVector(a - eig2, b, c, b, d - eig2, e, c, e, f - eig2);
}

function nullSpaceVector(
  a00: number, a01: number, a02: number,
  a10: number, a11: number, a12: number,
  a20: number, a21: number, a22: number,
): [number, number, number] {
  const c0: [number, number, number] = [
    a01 * a12 - a02 * a11,
    a02 * a10 - a00 * a12,
    a00 * a11 - a01 * a10,
  ];
  const c1: [number, number, number] = [
    a11 * a22 - a12 * a21,
    a12 * a20 - a10 * a22,
    a10 * a21 - a11 * a20,
  ];
  const c2: [number, number, number] = [
    a01 * a22 - a02 * a21,
    a02 * a20 - a00 * a22,
    a00 * a21 - a01 * a20,
  ];

  const l0 = c0[0] * c0[0] + c0[1] * c0[1] + c0[2] * c0[2];
  const l1 = c1[0] * c1[0] + c1[1] * c1[1] + c1[2] * c1[2];
  const l2 = c2[0] * c2[0] + c2[1] * c2[1] + c2[2] * c2[2];

  let best = c0;
  let bestLen = l0;
  if (l1 > bestLen) { best = c1; bestLen = l1; }
  if (l2 > bestLen) { best = c2; bestLen = l2; }

  if (bestLen < 1e-16) return [0, 0, 1];

  const inv = 1 / Math.sqrt(bestLen);
  return [best[0] * inv, best[1] * inv, best[2] * inv];
}

function orientNormals(
  normals: Float32Array,
  neighborIndices: Uint32Array,
  count: number,
  k: number,
): void {
  const visited = new Uint8Array(count);
  const queue: number[] = [0];
  visited[0] = 1;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const nx = normals[current * 3];
    const ny = normals[current * 3 + 1];
    const nz = normals[current * 3 + 2];

    const base = current * k;
    for (let j = 0; j < k; j++) {
      const ni = neighborIndices[base + j];
      if (visited[ni]) continue;
      visited[ni] = 1;

      const dot = nx * normals[ni * 3] + ny * normals[ni * 3 + 1] + nz * normals[ni * 3 + 2];
      if (dot < 0) {
        normals[ni * 3] *= -1;
        normals[ni * 3 + 1] *= -1;
        normals[ni * 3 + 2] *= -1;
      }

      queue.push(ni);
    }
  }
}
