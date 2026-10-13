import { MAT, PHASE } from '../../dist/sdk/state-space.js';
import { seedSpillway, SIZE, EXIT } from './scene.js';

export const GAME_VERSION = 'spillway-1';
export const Q = 256, PLAYER_W = 5, PLAYER_H = 9;
export const MAX_TICKS = 7200;
const SOLIDS = new Set([PHASE.SOLID, PHASE.POWDER, PHASE.FROZEN]);
const int = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;

export function commandFor(input = {}, tick) {
    const command = { tick, move: input.move ?? 0, jump: input.jump ?? false,
        tool: input.tool ?? 'none', target: input.target ?? null };
    if (!int(tick, 1, MAX_TICKS) || ![-1, 0, 1].includes(command.move) || typeof command.jump !== 'boolean' ||
        !['none', 'cut', 'heat'].includes(command.tool) || (command.target !== null &&
        (!Array.isArray(command.target) || command.target.length !== 2 || !command.target.every(v => int(v, 0, SIZE - 1))))) {
        throw new Error('Invalid tick command');
    }
    return { ...command, target: command.target && [...command.target] };
}

// Game-owned kinematic actor: fixed-point integers, swept cell collision, no
// wall time/randomness. The shared engine alone advances materials and support.
export class ReferenceGame {
    constructor(field) {
        this.field = field;
        seedSpillway(field);
        this.player = { x: 25 * Q, y: 167 * Q, vx: 0, vy: 0, facing: 1, grounded: true,
            wet: false, health: 100, cooldown: 0, hurtCooldown: 0, jumpHeld: false, blocked: false };
        this.status = 'playing'; this.bridgeIntact = true; this.events = []; this.commands = [];
        this.listeners = new Set();
        this.cells = { grid: new Uint32Array(SIZE * SIZE), energyQ: new Uint32Array(SIZE * SIZE), structure: new Uint32Array(SIZE * SIZE) };
        this.refresh();
        this.initial = this.snapshot();
    }
    refresh() { this.field.copyStateInto(this.cells); }
    onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    emit(type, details = {}) {
        const event = Object.freeze({ tick: this.field.tick, type, ...details });
        this.events.push(event);
        // Observers receive immutable facts; presentation callbacks run after step.
        this.pendingEvents.push(event);
    }
    solid(x, y) {
        if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return true;
        return SOLIDS.has((this.cells.grid[y * SIZE + x] >>> 24) & 15);
    }
    overlaps(x, y) {
        for (let cy = Math.floor(y / Q); cy <= Math.floor((y + PLAYER_H * Q - 1) / Q); cy++) {
            for (let cx = Math.floor(x / Q); cx <= Math.floor((x + PLAYER_W * Q - 1) / Q); cx++) if (this.solid(cx, cy)) return true;
        }
        return false;
    }
    sweep(axis, velocity) {
        const p = this.player, sign = Math.sign(velocity);
        let remaining = Math.abs(velocity);
        while (remaining > 0) {
            const distance = Math.min(remaining, Q), next = p[axis] + distance * sign;
            if (this.overlaps(axis === 'x' ? next : p.x, axis === 'y' ? next : p.y)) {
                // Find the last free sub-cell position without tunneling.
                let low = 0, high = distance;
                while (low + 1 < high) {
                    const mid = (low + high) >> 1, position = p[axis] + mid * sign;
                    if (this.overlaps(axis === 'x' ? position : p.x, axis === 'y' ? position : p.y)) high = mid;
                    else low = mid;
                }
                p[axis] += low * sign;
                return true;
            }
            p[axis] = next; remaining -= distance;
        }
        return false;
    }
    environment() {
        const p = this.player;
        let water = 0, hot = 0;
        for (let y = Math.floor(p.y / Q); y < Math.ceil(p.y / Q + PLAYER_H); y++) {
            for (let x = Math.floor(p.x / Q); x < Math.ceil(p.x / Q + PLAYER_W); x++) {
                const cell = this.cells.grid[y * SIZE + x], mat = cell & 255;
                if (mat === MAT.WATER) water++;
                if (mat === MAT.FIRE || mat === MAT.LAVA || ((cell >>> 8) & 255) > 180) hot++;
            }
        }
        return { wet: water >= 8, hot: hot > 0 };
    }
    tool(command) {
        const p = this.player;
        if (command.tool === 'none' || p.cooldown) return null;
        const cx = Math.floor(p.x / Q + PLAYER_W / 2), cy = Math.floor(p.y / Q + PLAYER_H / 2);
        const [tx, ty] = command.target ?? [cx + p.facing * 7, cy];
        if ((tx - cx) ** 2 + (ty - cy) ** 2 > 18 ** 2) return null;
        const radius = command.tool === 'cut' ? 5 : 2;
        let count = 0, flare = false;
        // The SDK circle editor normalizes support once for a whole cut. Use it
        // when the footprint contains only air/solid and no protected anchor.
        if (command.tool === 'cut') {
            let batch = true;
            for (let y = Math.max(0, ty - radius); y <= Math.min(SIZE - 1, ty + radius); y++) for (let x = Math.max(0, tx - radius); x <= Math.min(SIZE - 1, tx + radius); x++) {
                if ((x - tx) ** 2 + (y - ty) ** 2 > radius * radius) continue;
                const sample = this.field.sample(x, y);
                if (sample.anchored || (sample.material !== MAT.AIR && !this.solid(x, y))) batch = false;
                if (this.solid(x, y) && !sample.anchored) count++;
            }
            if (batch) {
                if (count) this.field.paintCircle(tx, ty, radius, MAT.AIR);
                p.cooldown = 12;
                return { type: 'terrain-cut', cells: count, x: tx, y: ty };
            }
            count = 0;
        }
        for (let y = Math.max(0, ty - radius); y <= Math.min(SIZE - 1, ty + radius); y++) {
            for (let x = Math.max(0, tx - radius); x <= Math.min(SIZE - 1, tx + radius); x++) {
                if ((x - tx) ** 2 + (y - ty) ** 2 > radius * radius) continue;
                const sample = this.field.sample(x, y);
                if (sample.anchored) continue;
                if (command.tool === 'cut' && this.solid(x, y)) { this.field.setCell(x, y, MAT.AIR); count++; }
                if (command.tool === 'heat') {
                    if (!flare && (sample.material === MAT.AIR || sample.material === MAT.SMOKE)) {
                        this.field.setCell(x, y, MAT.FIRE, 255); this.field.setEnergy(x, y, 650 * Q); count++;
                        flare = true;
                    } else if (sample.material === MAT.WOOD) { this.field.setEnergy(x, y, Math.max(sample.energyQ, 220 * Q)); count++; }
                }
            }
        }
        p.cooldown = 12;
        return { type: command.tool === 'cut' ? 'terrain-cut' : 'heat-applied', cells: count, x: tx, y: ty };
    }
    async step(input = {}) {
        const command = commandFor(input, this.field.tick + 1), p = this.player;
        if (input.tick !== undefined && input.tick !== command.tick) throw new Error('Replay command tick mismatch');
        this.pendingEvents = [];
        if (p.cooldown) p.cooldown--;
        if (p.hurtCooldown) p.hurtCooldown--;
        const action = this.status === 'playing' ? this.tool(command) : null;
        await this.field.step(1);
        this.refresh();
        if (action) { const { type, ...details } = action; this.emit(type, details); }
        if (this.status === 'playing') {
            // Moving terrain may occupy the previous actor position. Resolve in
            // a fixed nearest-distance/up-first order, or report crushing.
            if (this.overlaps(p.x, p.y)) {
                let free = false;
                for (let d = 1; d <= 10 && !free; d++) for (const [dx, dy] of [[0, -d], [-d, 0], [d, 0], [0, d]]) {
                    if (!this.overlaps(p.x + dx * Q, p.y + dy * Q)) {
                        p.x += dx * Q; p.y += dy * Q; p.vy = 0; free = true; break;
                    }
                }
                if (!free) { p.health = 0; this.status = 'lost'; this.emit('crushed'); }
            }
            if (this.status === 'playing') {
                const before = this.environment();
                p.vx = command.move * (before.wet ? 160 : 288);
                if (command.move) p.facing = command.move;
                if (command.jump && (before.wet || (!p.jumpHeld && p.grounded))) {
                    p.vy = before.wet ? -300 : -950;
                    if (!p.jumpHeld) this.emit(before.wet ? 'swam' : 'jumped');
                }
                p.vy = Math.min(before.wet ? 192 : 768, p.vy + (before.wet ? 22 : 64));
                const startX = p.x, startY = p.y;
                let blocked = this.sweep('x', p.vx);
                if (blocked && p.grounded) for (let rise = 1; rise <= 2; rise++) {
                    p.x = startX; p.y = startY - rise * Q;
                    if (!this.overlaps(p.x, p.y) && !this.sweep('x', p.vx)) { blocked = false; break; }
                    p.x = startX; p.y = startY;
                }
                if (blocked) { p.x = startX; p.y = startY; this.sweep('x', p.vx); }
                if (blocked && !p.blocked) this.emit('blocked');
                p.blocked = blocked;
                const falling = p.vy > 0, hit = this.sweep('y', p.vy), wasGrounded = p.grounded;
                if (hit) p.vy = 0;
                p.grounded = (hit && falling) || this.overlaps(p.x, p.y + 1);
                if (p.grounded && !wasGrounded) this.emit('landed');
                const after = this.environment();
                if (after.wet !== p.wet) this.emit(after.wet ? 'water-entered' : 'water-left');
                if (p.wet && !after.wet && command.jump) p.vy = Math.min(p.vy, -1080);
                p.wet = after.wet;
                if (after.hot && !p.hurtCooldown) { p.health = Math.max(0, p.health - 10); p.hurtCooldown = 30; this.emit('burned', { health: p.health }); }
                if (!p.health) { this.status = 'lost'; this.emit('lost'); }
                else if (p.x / Q >= EXIT.x - 3 && Math.abs(p.y / Q - EXIT.y) < 12) { this.status = 'won'; this.emit('relay-recovered'); }
            }
        }
        p.jumpHeld = command.jump;
        if (this.bridgeIntact) {
            let wood = 0;
            for (let y = 174; y <= 176; y++) for (let x = 107; x <= 149; x++) if ((this.cells.grid[y * SIZE + x] & 255) === MAT.WOOD) wood++;
            if (wood < 100) { this.bridgeIntact = false; this.emit('bridge-collapsed', { remainingDeckCells: wood }); }
        }
        this.commands.push(command);
        for (const event of this.pendingEvents) for (const listener of this.listeners) {
            try { listener(event); } catch (error) { console.error('Gameplay event observer:', error); }
        }
        return this.pendingEvents;
    }
    snapshot() {
        return { version: GAME_VERSION, field: this.field.packedSnapshot(), player: { ...this.player },
            status: this.status, bridgeIntact: this.bridgeIntact, events: this.events.map(e => ({ ...e })),
            energyBalance: Object.fromEntries(Object.entries(this.field.energyBalance()).map(([key, value]) => [key, String(value)])) };
    }
    reset() {
        this.field.restore(this.initial.field); this.player = { ...this.initial.player };
        this.status = this.initial.status; this.bridgeIntact = this.initial.bridgeIntact;
        this.events = []; this.commands = []; this.refresh();
    }
}
