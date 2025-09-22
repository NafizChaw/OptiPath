// untested, just a starting point for the Uniform Cost Search algo (UCS)
export type Seconds = number;
export type Matrix = Seconds[][];

type PQItem<T> = { priority: number; value: T };

class PriorityQueue<T> {
    private heap: PQItem<T>[] = [];
    push(item: PQItem<T>) {
        this.heap.push(item);
        this.bubbleUp(this.heap.length - 1);
    }
    pop(): PQItem<T> | undefined {
        if (!this.heap.length) return undefined;
        const top = this.heap[0];
        const end = this.heap.pop()!;
        if (this.heap.length) {
            this.heap[0] = end;
            this.bubbleDown(0);
        }
        return top;
    }
    get size() { return this.heap.length; }
    private bubbleUp(i: number) {
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (this.heap[i].priority >= this.heap[p].priority) break;
            [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
            i = p;
        }
    }
    private bubbleDown(i: number) {
        const n = this.heap.length;
        while (true) {
            const l = i * 2 + 1, r = i * 2 + 2;
            let m = i;
            if (l < n && this.heap[l].priority < this.heap[m].priority) m = l;
            if (r < n && this.heap[r].priority < this.heap[m].priority) m = r;
            if (m === i) break;
            [this.heap[i], this.heap[m]] = [this.heap[m], this.heap[i]];
            i = m;
        }
    }
}

type State = {
    node: number;        // current node index
    visited: number;     // bitmask of visited nodes
    path: number[];      // order so far
    cost: Seconds;       // total time so far
};


export function ucsBestOrder( time: Matrix, start: number, 
    returnToStart = false ): { order: number[]; totalSeconds: Seconds } {
    const n = time.length;
    if (start < 0 || start >= n) throw new Error("start index out of range");
    const goalVisitedMask = (1 << n) - 1;

    const pq = new PriorityQueue<State>();
    const startState: State = { node: start, visited: 1 << start, path: [start], cost: 0 };
    pq.push({ priority: 0, value: startState });

    const best = new Map<string, Seconds>();
    const key = (node: number, visited: number) => `${node}|${visited}`;

    best.set(key(startState.node, startState.visited), 0);

    while (pq.size) {
        const cur = pq.pop()!.value;

        if (!returnToStart && cur.visited === goalVisitedMask) {
            return { order: cur.path, totalSeconds: cur.cost };
        }

        if (returnToStart && cur.visited === goalVisitedMask) {
            if (cur.node === start) {
                return { order: cur.path, totalSeconds: cur.cost };
            }
            const back = time[cur.node][start];
            if (isFinite(back)) {
                const nextCost = cur.cost + back;
                const k = key(start, cur.visited);
                const known = best.get(k);
                if (known === undefined || nextCost < known) {
                    best.set(k, nextCost);
                    pq.push({ priority: nextCost,
                        value: { node: start, visited: cur.visited, path: [...cur.path, start], cost: nextCost }
                    });
                }
            }
        }

        for (let nxt = 0; nxt < n; nxt++) {
            if (cur.visited & (1 << nxt)) continue;
            const leg = time[cur.node][nxt];
            if (!isFinite(leg)) continue;

            const nextVisited = cur.visited | (1 << nxt);
            const nextCost = cur.cost + leg;
            const k = key(nxt, nextVisited);
            const known = best.get(k);
            if (known === undefined || nextCost < known) {
                best.set(k, nextCost);
                pq.push({
                    priority: nextCost,
                    value: { node: nxt, visited: nextVisited, path: [...cur.path, nxt], cost: nextCost }
                });
            }
        }
    }

    return { order: [start], totalSeconds: Infinity };
}
