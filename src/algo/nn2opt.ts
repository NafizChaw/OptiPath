import type { TimeMatrix } from './timeMatrix';
export type Seconds = number;

export function routeTime(order: number[], mat: TimeMatrix, returnToStart = false): Seconds {
  let t = 0;
  for (let i = 0; i < order.length - 1; i++) t += mat[order[i]][order[i+1]];
  if (returnToStart) t += mat[order[order.length - 1]][order[0]];
  return t;
}

export function nearestNeighborOrder(mat: TimeMatrix, start = 0): number[] {
  const n = mat.length, visited = Array(n).fill(false), order = [start];
  visited[start] = true;
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1, bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && mat[last][j] < bestCost) { best = j; bestCost = mat[last][j]; }
    }
    if (best === -1) break;
    order.push(best); visited[best] = true;
  }
  for (let j = 0; j < n; j++) if (!visited[j]) order.push(j);
  return order;
}

export function twoOptImprove(orderIn: number[], mat: TimeMatrix, returnToStart = false, maxPasses = 50) {
  let order = orderIn.slice(), improved = true, passes = 0;
  const n = order.length;
  if (n < 4) return order;

  function delta(i: number, k: number): number {
    const a = order[(i - 1 + n) % n], b = order[i], c = order[k], d = order[(k + 1) % n];
    const before = mat[a][b] + mat[c][d], after = mat[a][c] + mat[b][d];
    if (!returnToStart && (i === 0 || k === n - 1)) return 0; // keep ends fixed
    return after - before; // negative = improvement
  }

  while (improved && passes < maxPasses) {
    improved = false; passes++;
    for (let i = 1; i < n - 2; i++) {
      for (let k = i + 1; k < n - (returnToStart ? 0 : 1); k++) {
        const gain = delta(i, k);
        if (gain < -1e-6) {
          const segment = order.slice(i, k + 1).reverse();
          order.splice(i, segment.length, ...segment);
          improved = true;
        }
      }
    }
  }
  return order;
}

export function relocateImprove(orderIn: number[], mat: TimeMatrix, returnToStart = false, maxPasses = 50) {
  const n = orderIn.length;
  if (n < 3) return orderIn.slice();
  let order = orderIn.slice(), improved = true, passes = 0;

  function deltaRelocate(k: number, j: number): number {
    const A = order[(k - 1 + n) % n], B = order[k], C = order[(k + 1) % n];
    let before = mat[A][B] + mat[B][C], after = mat[A][C];
    if (!returnToStart && (k === 0 || k === n - 1)) return 0;
    if (j === k || j === k + 1) return 0;

    const X = order[(j - 1 + n) % n], Y = order[j % n];
    before += mat[X][Y]; after += mat[X][B] + mat[B][Y];
    if (!returnToStart && (j === 0 || j === n)) return 0;
    return after - before; // negative is good
  }

  while (improved && passes < maxPasses) {
    improved = false; passes++;
    for (let k = 1; k < n - (returnToStart ? 0 : 1); k++) {
      let bestJ = -1, bestGain = 0;
      for (let j = 0; j <= n - (returnToStart ? 0 : 1); j++) {
        const gain = deltaRelocate(k, j);
        if (gain < bestGain) { bestGain = gain; bestJ = j; }
      }
      if (bestJ !== -1) {
        const [node] = order.splice(k, 1);
        const insertAt = bestJ > k ? bestJ - 1 : bestJ;
        order.splice(insertAt, 0, node);
        improved = true;
      }
    }
  }
  return order;
}

export function bestOrderNN2Opt(mat: TimeMatrix, start = 0, returnToStart = false) {
  const nn = nearestNeighborOrder(mat, start);
  const after2 = twoOptImprove(nn, mat, returnToStart);
  const afterRelocate = relocateImprove(after2, mat, returnToStart);
  const total = routeTime(afterRelocate, mat, returnToStart);
  return { order: afterRelocate, totalSeconds: total };
}
