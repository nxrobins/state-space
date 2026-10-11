/* Exact ca-v3 global support/fragment solver. No imports, allocation, floats,
 * local horizon or runtime compilation. Hosts own and validate linear memory.
 * Layout: 6144 cold + 3072 thermodynamics u32s, then 15 count-sized arrays. */
#include <stdint.h>
#include "structure_constants.h"

enum { GRID, ENERGY, WORDS, SOURCES, STRUCTURE, LOADS, CAPACITIES, REACTIONS,
       DISTANCES, PARENTS, QUEUE, BLOCKED, HEADS, NEXT, DAMAGED, FIELDS };
static uint32_t supported_weight;
static uint64_t total_energy, sensible_energy, chemical_energy;
uint32_t abi_version(void) { return 1; }
uint32_t weight(void) { return supported_weight; }
uint64_t ledger_total(void) { return total_energy; }
uint64_t ledger_sensible(void) { return sensible_energy; }
uint64_t ledger_chemical(void) { return chemical_energy; }

static uint32_t prop(const uint32_t *cold, uint32_t voxel, uint32_t field) {
    return cold[(voxel & 255) * COLD_STRIDE + field];
}
static uint32_t temperature(const uint32_t *table, uint32_t voxel, uint32_t energy) {
    const uint32_t *row = table + (voxel & 255) * 12;
    uint32_t heat = energy - row[2];
    uint32_t phase = row[1];
    uint32_t result = heat > phase ? heat - phase : 0;
    uint32_t up = row[3], up_t = row[4], down = row[5], down_t = row[6];
    if (up != 256 && (uint64_t)heat >= (uint64_t)phase + up_t) {
        uint32_t other = table[up * 12 + 1];
        result = heat > other ? heat - other : 0;
        if (result < up_t) result = up_t;
    } else if (down != 256 && (uint64_t)heat <= (uint64_t)phase + down_t) {
        uint32_t other = table[down * 12 + 1];
        result = heat > other ? heat - other : 0;
        if (result > down_t) result = down_t;
    }
    return result;
}

/* Native public boundaries copy/check integer arrays before this complete-state
 * validator. Private thermal slot 0 marks defined materials and has no other
 * meaning; the cold rows are the registry's own values, with no reused slot. */
uint32_t validate(uint32_t width, uint32_t height, const uint32_t *base) {
    uint32_t n = width * height;
    const uint32_t *thermal = base + 256 * COLD_STRIDE;
    const uint32_t *grid = base + 256 * (COLD_STRIDE + 12);
    const uint32_t *energy = grid + n, *words = energy + n;
    const uint32_t bits[4] = {BOND_UP, BOND_LEFT, BOND_RIGHT, BOND_DOWN};
    const uint32_t reverse[4] = {BOND_DOWN, BOND_RIGHT, BOND_LEFT, BOND_UP};
    for (uint32_t i = 0; i < n; ++i) {
        uint32_t id = grid[i] & 255, word = words[i], x = i % width;
        if (!thermal[id * 12]) return 1;
        if (energy[i] > 0x3fffffffu || energy[i] < thermal[id * 12 + 2]) return 2;
        uint32_t byte = temperature(thermal, grid[i], energy[i]) / 256;
        if (byte > 255) byte = 255;
        if (((grid[i] >> 8) & 255) != byte) return 3;
        if (word > (INTEGRITY | ANCHOR | BOND_UP | BOND_LEFT | BOND_RIGHT | BOND_DOWN)) return 4;
        uint32_t phase = (grid[i] >> 24) & 15;
        if (word && ((phase != PHASE_SOLID && phase != PHASE_FROZEN) || !prop(base, grid[i], COLD_COHESION))) return 5;
        int32_t adjacent[4] = {i >= width ? (int32_t)(i - width) : -1,
            x ? (int32_t)(i - 1) : -1, x + 1 < width ? (int32_t)(i + 1) : -1,
            i + width < n ? (int32_t)(i + width) : -1};
        for (uint32_t d = 0; d < 4; ++d) if (word & bits[d]) {
            int32_t j = adjacent[d];
            if (!(word & INTEGRITY) || j < 0 || !(words[j] & INTEGRITY) || !(words[j] & reverse[d])) return 6;
        }
    }
    return 0;
}

/* Only complete validated states reach accounting. World and per-cell limits
 * bound all three reductions below signed i64; no clipped thermal byte is used. */
void ledger(uint32_t width, uint32_t height, const uint32_t *base) {
    uint32_t n = width * height;
    const uint32_t *thermal = base + 256 * COLD_STRIDE;
    const uint32_t *grid = base + 256 * (COLD_STRIDE + 12), *energy = grid + n;
    total_energy = sensible_energy = chemical_energy = 0;
    for (uint32_t i = 0; i < n; ++i) {
        total_energy += energy[i];
        sensible_energy += temperature(thermal, grid[i], energy[i]);
        chemical_energy += thermal[(grid[i] & 255) * 12 + 2];
    }
}
static uint32_t root(int32_t *parents, uint32_t i) {
    uint32_t r = i;
    while ((uint32_t)parents[r] != r) r = (uint32_t)parents[r];
    while ((uint32_t)parents[i] != i) {
        uint32_t next = (uint32_t)parents[i]; parents[i] = (int32_t)r; i = next;
    }
    return r;
}
static int grain_blocked(const uint32_t *cold, const uint32_t *grid, const uint32_t *words, uint32_t i, uint32_t j) {
    return (words[j] & ANCHOR) || prop(cold, grid[i], COLD_DENSITY) <= prop(cold, grid[j], COLD_DENSITY);
}

uint32_t solve(uint32_t width, uint32_t height, uint32_t *base) {
    uint64_t size = (uint64_t)width * height;
    if (!width || !height || size > 0x3fffffff) return 1;
    uint32_t n = (uint32_t)size;
    const uint32_t *cold = base;
    const uint32_t *thermal = base + 256 * COLD_STRIDE;
    uint32_t *a[FIELDS];
    for (uint32_t f = 0; f < FIELDS; ++f) a[f] = base + 256 * (COLD_STRIDE + 12) + f * n;
    uint32_t *grid = a[GRID], *energy = a[ENERGY], *words = a[WORDS];
    uint32_t *sources = a[SOURCES], *output = a[STRUCTURE], *loads = a[LOADS];
    uint32_t *capacity = a[CAPACITIES], *reactions = a[REACTIONS], *queue = a[QUEUE];
    uint32_t *blocked = a[BLOCKED], *damaged = a[DAMAGED];
    int32_t *distance = (int32_t *)a[DISTANCES], *parents = (int32_t *)a[PARENTS];
    int32_t *heads = (int32_t *)a[HEADS], *next = (int32_t *)a[NEXT];
    const uint32_t bits[4] = {BOND_UP, BOND_LEFT, BOND_RIGHT, BOND_DOWN};
    uint32_t tail = 0;
    supported_weight = 0;
    for (uint32_t i = 0; i < n; ++i) {
        distance[i] = -1; loads[i] = capacity[i] = reactions[i] = blocked[i] = 0;
        heads[i] = next[i] = -1; sources[i] = i; damaged[i] = words[i];
        if (!(words[i] & INTEGRITY)) continue;
        if ((words[i] & ANCHOR) || i + width >= n ||
            (!(words[i + width] & INTEGRITY) && grain_blocked(cold, grid, words, i, i + width))) {
            distance[i] = 0; queue[tail++] = i;
        }
    }
    /* Sorted roots and sorted cardinal followers reproduce the scalar BFS.
     * Vertical contact adds only the upward follower, without welding. */
    for (uint32_t head = 0; head < tail; ++head) {
        uint32_t i = queue[head], x = i % width;
        int32_t adjacent[4] = {i >= width ? (int32_t)(i - width) : -1,
            x ? (int32_t)(i - 1) : -1, x + 1 < width ? (int32_t)(i + 1) : -1,
            i + width < n ? (int32_t)(i + width) : -1};
        for (uint32_t d = 0; d < 4; ++d) {
            int32_t j = adjacent[d];
            if (j < 0 || distance[j] >= 0) continue;
            if (!(words[i] & bits[d]) && !(d == 0 && (words[j] & INTEGRITY))) continue;
            distance[j] = distance[i] + 1; queue[tail++] = (uint32_t)j;
        }
    }
    for (uint32_t k = 0; k < tail; ++k) {
        uint32_t i = queue[k], w = (prop(cold, grid[i], COLD_DENSITY) + 63) / 64;
        loads[i] = w ? w : 1; supported_weight += loads[i];
    }
    for (uint32_t k = tail; k > 0; --k) {
        uint32_t i = queue[k - 1], x = i % width;
        if (distance[i] == 0) { reactions[i] = loads[i]; continue; }
        int32_t adjacent[4] = {i >= width ? (int32_t)(i - width) : -1,
            x ? (int32_t)(i - 1) : -1, x + 1 < width ? (int32_t)(i + 1) : -1,
            i + width < n ? (int32_t)(i + width) : -1};
        uint32_t supports[4], count = 0;
        for (uint32_t d = 0; d < 4; ++d) {
            int32_t j = adjacent[d];
            if (j >= 0 && distance[j] == distance[i] - 1 &&
                ((words[i] & bits[d]) || (d == 3 && (words[j] & INTEGRITY)))) supports[count++] = (uint32_t)j;
        }
        if (!count) return 2;
        uint32_t share = loads[i] / count, remainder = loads[i] % count;
        for (uint32_t r = 0; r < count; ++r) loads[supports[r]] += share + (r < remainder);
    }
    uint64_t reaction_sum = 0;
    for (uint32_t i = 0; i < n; ++i) {
        reaction_sum += reactions[i];
        uint32_t integrity = words[i] & INTEGRITY;
        if (!integrity) continue;
        uint32_t nominal = prop(cold, grid[i], COLD_COHESION) * 16;
        uint32_t soft = prop(cold, grid[i], COLD_SOFTENING), remaining = 64 * 256;
        if (soft) {
            uint32_t temp = temperature(thermal, grid[i], energy[i]), upper = (soft + 64) * 256;
            remaining = temp >= upper ? 0 : upper - temp;
            if (remaining > 64 * 256) remaining = 64 * 256;
        }
        /* The numerator exceeds u32; preserve exact integer capacity/damage. */
        capacity[i] = (uint32_t)((uint64_t)nominal * integrity * remaining / (255 * 64 * 256));
        uint32_t loss = 0;
        if (!capacity[i]) loss = integrity;
        else if (loads[i] > capacity[i]) {
            uint64_t excess = (uint64_t)(loads[i] - capacity[i]) * 255 / nominal;
            loss = excess > integrity ? integrity : (excess ? (uint32_t)excess : 1);
        }
        damaged[i] = (words[i] & ~INTEGRITY) | (integrity - loss);
    }
    if (reaction_sum != supported_weight) return 3;
    for (uint32_t i = 0; i < n; ++i) {
        uint32_t x = i % width;
        if (!(damaged[i] & INTEGRITY)) { damaged[i] &= ANCHOR; parents[i] = -1; continue; }
        parents[i] = (int32_t)i;
        if (!x || !(damaged[i - 1] & INTEGRITY)) damaged[i] &= ~BOND_LEFT;
        if (x + 1 >= width || !(damaged[i + 1] & INTEGRITY)) damaged[i] &= ~BOND_RIGHT;
        if (i < width || !(damaged[i - width] & INTEGRITY)) damaged[i] &= ~BOND_UP;
        if (i + width >= n || !(damaged[i + width] & INTEGRITY)) damaged[i] &= ~BOND_DOWN;
    }
    for (uint32_t i = 0; i < n; ++i) {
        if (parents[i] < 0) continue;
        uint32_t adjacent[2] = {i + 1, i + width}, bits_forward[2] = {BOND_RIGHT, BOND_DOWN};
        for (uint32_t d = 0; d < 2; ++d) if (damaged[i] & bits_forward[d]) {
            uint32_t left = root(parents, i), right = root(parents, adjacent[d]);
            if (left < right) parents[right] = (int32_t)left; else parents[left] = (int32_t)right;
        }
    }
    for (uint32_t i = 0; i < n; ++i) if (parents[i] >= 0) parents[i] = (int32_t)root(parents, i);
    tail = 0;
    for (uint32_t i = 0; i < n; ++i) {
        if (parents[i] < 0) continue;
        uint32_t r = (uint32_t)parents[i];
        int stop = (damaged[i] & ANCHOR) || i + width >= n;
        if (!stop) {
            uint32_t below = i + width;
            if (parents[below] >= 0) {
                uint32_t lower = (uint32_t)parents[below];
                if (lower != r) { next[i] = heads[lower]; heads[lower] = (int32_t)i; }
            } else stop = grain_blocked(cold, grid, words, i, below);
        }
        if (stop && !blocked[r]) { blocked[r] = 1; queue[tail++] = r; }
    }
    for (uint32_t head = 0; head < tail; ++head) {
        for (int32_t edge = heads[queue[head]]; edge >= 0; edge = next[edge]) {
            uint32_t dependent = (uint32_t)parents[edge];
            if (!blocked[dependent]) { blocked[dependent] = 1; queue[tail++] = dependent; }
        }
    }
    for (uint32_t x = 0; x < width; ++x) {
        int32_t top = -1;
        for (uint32_t i = x; i < n; i += width) {
            if (parents[i] >= 0 && !blocked[parents[i]]) {
                if (i + width >= n) return 4;
                if (top < 0) top = (int32_t)i;
                sources[i + width] = i;
            } else if (top >= 0) { sources[top] = i; top = -1; }
        }
    }
    for (uint32_t i = 0; i < n; ++i) output[i] = damaged[sources[i]];
    return 0;
}
