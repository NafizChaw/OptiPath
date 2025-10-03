// src/algo/nn2opt_constrained.ts
// Constrained NN + 2-Opt + Relocate with "must-come-before" and optional fixed finish.
// Works with open path (returnToStart = false). Start index is fixed.

export type Seconds = number;
export type TimeMatrix = number[][];
export type Prereqs = Record<number, number[]>; // afterIndex -> [beforeIndex,...]

function routeTime(order: number[], mat: TimeMatrix, returnToStart = false): Seconds {
  let t = 0;
  for (let i = 0; i < order.length - 1; i++) t += mat[order[i]][order[i + 1]];
  if (returnToStart) t += mat[order[order.length - 1]][order[0]];
  return t;
}

function violatesPrereqs(
  order: number[],
  prereqs: Prereqs | undefined,
  endIndex: number | undefined,
  startFixed = true,
  returnToStart = false
): boolean {
  if (!order.length) return false;

  // start fixed for open path
  if (!returnToStart && startFixed) {
    // start index is whatever sits at position 0 (caller ensures it)
    // nothing to check here
  }

  // fixed finish if provided (open path)
  if (!returnToStart && endIndex !== undefined) {
    if (order[order.length - 1] !== endIndex) return true;
  }

  if (!prereqs) return false;
  const pos: Record<number, number> = {};
  order.forEach((n, i) => (pos[n] = i));

  for (const [afterStr, beforeList] of Object.entries(prereqs)) {
    const after = Number(afterStr);
    if (!(after in pos)) continue;
    for (const b of beforeList || []) {
      if (!(b in pos)) continue;
      if (pos[b] >= pos[after]) return true; // before must appear earlier
    }
  }
  return false;
}

function nearestNeighborConstrained(
  mat: TimeMatrix,
  start: number,
  prereqs?: Prereqs,
  endIndex?: number,
  returnToStart = false
): number[] {
  const n = mat.length;
  const visited = Array(n).fill(false);
  const order: number[] = [start];
  visited[start] = true;

  // If endIndex fixed for open path, we will place it last; mark it as "not available until last"
  const isFixedEnd = !returnToStart && endIndex !== undefined;

  // Build a quick prereq map
  const pre = prereqs ?? {};

  while (order.length < n) {
    const last = order[order.length - 1];

    // candidates are unvisited nodes whose all prereqs are already in order
    const candidates: number[] = [];
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      if (isFixedEnd && j === endIndex && order.length < n - 1) continue; // keep end for last
      const reqs = pre[j] || [];
      let ok = true;
      for (const r of reqs) {
        if (!visited[r]) {
          ok = false;
          break;
        }
      }
      if (ok) candidates.push(j);
    }

    // if no candidate is available due to constraint cycles, relax to any unvisited except fixed end
    const pool = candidates.length
      ? candidates
      : Array.from({ length: n }, (_, j) => j).filter((j) => {
          if (visited[j]) return false;
          if (isFixedEnd && j === endIndex && order.length < n - 1) return false;
          return true;
        });

    if (!pool.length) break; // only fixed end left; will be added below

    // pick NN from pool
    let best = -1,
      bestCost = Infinity;
    for (const j of pool) {
      const c = mat[last][j];
      if (c < bestCost) {
        best = j;
        bestCost = c;
      }
    }
    if (best === -1) break;
    order.push(best);
    visited[best] = true;
  }

  // place fixed end last if needed
  if (isFixedEnd && !visited[endIndex!]) {
    order.push(endIndex!);
  }

  return order;
}

// Try a move only if it keeps constraints valid and improves cost
function tryApplyIfValid(
  order: number[],
  mat: TimeMatrix,
  prereqs?: Prereqs,
  endIndex?: number,
  returnToStart = false
): { improved: boolean; order: number[] } {
  const n = order.length;

  // 2-Opt
  for (let i = 1; i < n - 2; i++) {
    for (let k = i + 1; k < n - (returnToStart ? 0 : 1); k++) {
      // do not break endpoints in open path
      if (!returnToStart && (i === 0 || k === n - 1)) continue;

      const cand = order.slice();
      const segment = cand.slice(i, k + 1).reverse();
      cand.splice(i, segment.length, ...segment);

      if (violatesPrereqs(cand, prereqs, endIndex, true, returnToStart)) continue;

      const before = routeTime(order, mat, returnToStart);
      const after = routeTime(cand, mat, returnToStart);
      if (after + 1e-6 < before) {
        return { improved: true, order: cand };
      }
    }
  }

  // Relocate (Or-opt 1)
  for (let k = 1; k < n - (returnToStart ? 0 : 1); k++) {
    for (let j = 0; j <= n - (returnToStart ? 0 : 1); j++) {
      if (j === k || j === k + 1) continue;
      const cand = order.slice();
      const [node] = cand.splice(k, 1);
      const insertAt = j > k ? j - 1 : j;
      cand.splice(insertAt, 0, node);

      if (violatesPrereqs(cand, prereqs, endIndex, true, returnToStart)) continue;

      const before = routeTime(order, mat, returnToStart);
      const after = routeTime(cand, mat, returnToStart);
      if (after + 1e-6 < before) {
        return { improved: true, order: cand };
      }
    }
  }

  return { improved: false, order };
}

export function bestOrderNN2OptConstrained(
  mat: TimeMatrix,
  startIndex: number,
  returnToStart: boolean,
  prereqs?: Prereqs,
  endIndex?: number
): { order: number[]; totalSeconds: Seconds } {
  // initial feasible order
  let order = nearestNeighborConstrained(
    mat,
    startIndex,
    prereqs,
    endIndex,
    returnToStart
  );

  // if somehow initial violates (e.g., impossible constraints), fall back to identity
  if (violatesPrereqs(order, prereqs, endIndex, true, returnToStart)) {
    order = Array.from({ length: mat.length }, (_, i) => i);
    // rotate to keep start fixed at index 0
    if (startIndex > 0) {
      const rotated = [...order.slice(startIndex), ...order.slice(0, startIndex)];
      order = rotated;
    }
    // force end at last if provided
    if (!returnToStart && endIndex !== undefined) {
      order = order.filter((x) => x !== endIndex);
      order.push(endIndex);
    }
  }

  // local search with constraint checks
  let passes = 0;
  while (passes < 60) {
    const res = tryApplyIfValid(order, mat, prereqs, endIndex, returnToStart);
    if (!res.improved) break;
    order = res.order;
    passes++;
  }

  const totalSeconds = routeTime(order, mat, returnToStart);
  return { order, totalSeconds };
}
