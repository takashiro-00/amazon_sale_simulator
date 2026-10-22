/** Mulberry32; forks derive from immutable seed/path, never consumption order. */
export class Rng {
    private state: number;
    constructor(private readonly seed: string | number, private readonly path = '') {
        this.state = this.hash(`${seed}/${path}`);
    }
    private hash(s: string): number {
        let h = 2166136261;
        for (const c of s)
            h = Math.imul(h ^ c.charCodeAt(0), 16777619);
        return h >>> 0;
    }
    fork(label: string): Rng {
        return new Rng(this.seed, `${this.path}/${label.length}:${label}`);
    }
    uniform(min = 0, max = 1): number {
        let t = this.state = (this.state + 0x6d2b79f5) >>> 0;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return min + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (max - min);
    }
    poisson(lambda: number): number {
        if (!Number.isFinite(lambda) || lambda < 0)
            throw new RangeError('Invalid poisson mean');
        // Independent Poisson chunks avoid underflow without a Gaussian approximation.
        let n = 0;
        while (lambda > 0) {
            const part = Math.min(lambda, 30), limit = Math.exp(-part);
            let p = 1, k = 0;
            do {
                k++;
                p *= this.uniform();
            } while (p > limit);
            n += k - 1;
            lambda -= part;
        }
        return n;
    }
    binomial(n: number, p: number): number {
        if (!Number.isInteger(n) || n < 0 || !Number.isFinite(p) || p < 0 || p > 1)
            throw new RangeError('Invalid binomial parameters');
        if (p === 0 || n === 0)
            return 0;
        if (p === 1)
            return n;
        // Exact geometric waiting times skip failures; symmetry handles p > 1/2.
        const complement = p > .5, probability = complement ? 1 - p : p;
        const logFailure = Math.log1p(-probability);
        let position = -1, count = 0;
        while (true) {
            position += 1 + Math.floor(Math.log1p(-this.uniform()) / logFailure);
            if (position >= n)
                break;
            count++;
        }
        return complement ? n - count : count;
    }
    categorical(weights: readonly number[]): number {
        const total = weights.reduce((a, b) => a + b, 0);
        if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0) || total <= 0)
            throw new RangeError('Invalid weights');
        let x = this.uniform(0, total);
        for (let i = 0; i < weights.length; i++) {
            x -= weights[i]!;
            if (x < 0)
                return i;
        }
        return weights.length - 1;
    }
    lognormal(mu: number, sigma: number): number {
        return Math.exp(mu + sigma * Math.sqrt(-2 * Math.log(1 - this.uniform())) * Math.cos(2 * Math.PI * this.uniform()));
    }
}
