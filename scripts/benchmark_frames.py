"""Verify A/B isolation and benchmark GPU-completed native/browser full frames."""
import argparse
import functools
import hashlib
import http.server
import json
import shutil
import struct
import sys
import threading
import time
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import wgpu

from engine import MaterialRenderer, create_field
from engine.schema import MAT_LAVA, MAT_SMOKE, MAT_STEAM, MAT_WATER
from engine.verify import ROOT, source_hashes
from scripts.verify_browser import digest, run_captured


def distribution(samples):
    values = sorted(samples)
    n = len(values)
    return {'samples': samples, 'count': n, 'min': values[0], 'max': values[-1],
            'median': (values[(n - 1) // 2] + values[n // 2]) / 2, 'p95': values[int(np.ceil(n * .95)) - 1]}


def state_hash(field):
    data = b''.join(np.asarray(values, dtype='<u4').tobytes() for values in (field.grid, field.energy_q, field.structure))
    return hashlib.sha256(data).hexdigest()


def write_png(path, rgba, width, height):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    scanlines = b''.join(b'\0' + rgba[y * width * 4:(y + 1) * width * 4] for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', width, height, 8, 6, 0, 0, 0))
                     + chunk(b'IDAT', zlib.compress(scanlines)) + chunk(b'IEND', b''))


def native_frames(output, browser, samples=120, warmup=12):
    script = """import fs from 'node:fs';
import { createStateSpaceField } from './dist/sdk/state-space.js';
import { seedScene, FRAME_SCENES } from './web/demo.js';
const result={};
for(const scene of FRAME_SCENES) {
 const field=createStateSpaceField(256,256);
 seedScene(field,scene);
 result[scene]=field.packedSnapshot(); field.close();
}
fs.writeFileSync(process.argv[1],JSON.stringify(result));"""
    scene_file = output / 'initial-scenes.json'
    code, _, error = run_captured([shutil.which('node'), '--input-type=module', '-e', script, str(scene_file)])
    if code:
        raise RuntimeError(error)
    scenes = json.loads(scene_file.read_text())
    rows = []
    for scene, initial in scenes.items():
        expected = next(row for row in browser['rows'] if row['scene'] == scene)
        modes = ['plain', 'styled', 'alternating']
        if scene == 'water':
            modes.append('water-off')
        if scene == 'haze':
            modes.append('haze-off')
        if scene == 'heat':
            modes.append('distortion-off')
        for mode in modes:
            print(f'Native frame benchmark: {scene} / {mode}', flush=True)
            with create_field(256, 256) as field, MaterialRenderer(256, 256) as renderer:
                field.restore(initial)
                before = field.snapshot().to_dict()
                renderer.render(field, styled=False)
                plain = renderer.read_pixels()
                renderer.render(field)
                styled = renderer.read_pixels()
                renderer.render(field, lighting=False)
                unlit = renderer.read_pixels()
                renderer.render(field, water=False)
                opaque_water = renderer.read_pixels()
                renderer.render(field, haze=False)
                flat_gas = renderer.read_pixels()
                renderer.render(field, distortion=False)
                still_air = renderer.read_pixels()
                if field.snapshot().to_dict() != before or plain == styled or (scene != 'emissive' and styled == unlit):
                    raise ValueError('Native A/B isolation or visual distinction failed')
                if scene == 'water' and styled == opaque_water:
                    raise ValueError('Water optics produced no image difference')
                if scene == 'haze' and styled == flat_gas:
                    raise ValueError('Volumetric haze produced no image difference')
                if scene == 'heat' and styled == still_air:
                    raise ValueError('Heat distortion produced no image difference')
                if scene == 'bridge' and mode == 'styled':
                    write_png(output / 'native-plain.png', plain, 1920, 1080)
                    write_png(output / 'native-styled.png', styled, 1920, 1080)
                    write_png(output / 'native-unlit.png', unlit, 1920, 1080)
                if scene == 'lighting' and mode == 'styled':
                    write_png(output / 'native-gallery.png', styled, 1920, 1080)
                    write_png(output / 'native-gallery-unlit.png', unlit, 1920, 1080)
                if scene == 'water' and mode == 'styled':
                    write_png(output / 'native-water.png', styled, 1920, 1080)
                    write_png(output / 'native-water-off.png', opaque_water, 1920, 1080)
                if scene == 'haze' and mode == 'styled':
                    write_png(output / 'native-haze.png', styled, 1920, 1080)
                    write_png(output / 'native-haze-unlit.png', unlit, 1920, 1080)
                    write_png(output / 'native-haze-off.png', flat_gas, 1920, 1080)
                if scene == 'heat' and mode == 'styled':
                    write_png(output / 'native-heat.png', styled, 1920, 1080)
                    write_png(output / 'native-heat-off.png', still_air, 1920, 1080)
                if scene == 'pressure' and mode == 'styled':
                    write_png(output / 'native-pressure.png', styled, 1920, 1080)
                frames, physics, rendering = [], [], []
                for i in range(warmup + samples):
                    started = time.perf_counter()
                    field.step(1)
                    physics_done = time.perf_counter()
                    renderer.render(field, styled=mode in ('styled', 'water-off', 'haze-off', 'distortion-off') or (mode == 'alternating' and i % 2 == 0), water=mode != 'water-off', haze=mode != 'haze-off', distortion=mode != 'distortion-off')
                    finished = time.perf_counter()
                    if i >= warmup or scene == 'pressure':
                        frames.append((finished - started) * 1000)
                        physics.append((physics_done - started) * 1000)
                        rendering.append((finished - physics_done) * 1000)
                final_hash = state_hash(field)
                if final_hash != expected['finalHash'] or field.tick != expected['endTick'] or field.energy_balance().drift_q != 0:
                    raise ValueError('Native rendered state differs from CPU/browser reference')
                final_lava_cells = int(np.count_nonzero((field.grid & 255) == MAT_LAVA))
                final_water_cells = int(np.count_nonzero((field.grid & 255) == MAT_WATER))
                final_smoke_cells = int(np.count_nonzero((field.grid & 255) == MAT_SMOKE))
                final_steam_cells = int(np.count_nonzero((field.grid & 255) == MAT_STEAM))
                if final_lava_cells != expected['finalLavaCells'] or (scene in ('lighting', 'water', 'haze', 'heat') and final_lava_cells < 64):
                    raise ValueError('Lighting source continuation differs')
                if final_water_cells != expected['finalWaterCells'] or (scene == 'water' and final_water_cells < 1024):
                    raise ValueError('Water continuation differs')
                if final_smoke_cells != expected['finalSmokeCells'] or final_steam_cells != expected['finalSteamCells']:
                    raise ValueError('Gas continuation differs')
                if scene in ('haze', 'heat') and (final_smoke_cells < 1024 or final_steam_cells < 1024):
                    raise ValueError('Haze expired before measurement ended')
                water_proof = {}
                if scene == 'water' and mode == 'styled':
                    renderer.render(field, lighting=False, bloom=False, refraction=False, haze=False, distortion=False)
                    wet = renderer.read_pixels()
                    renderer.render(field, lighting=False, bloom=False, water=False, haze=False, distortion=False)
                    dry = renderer.read_pixels()
                    a = np.frombuffer(wet, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    b = np.frombuffer(dry, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    centers = ((np.arange(256) + .5) * 1080 / 256).astype(int)
                    delta = a[centers[:, None], centers[None, :] + 420, :3] - b[centers[:, None], centers[None, :] + 420, :3]
                    water_mask = (field.grid.reshape(256, 256) & 255) == MAT_WATER
                    changed = int(np.count_nonzero(water_mask & (np.max(np.abs(delta), axis=2) > 3)))
                    reflected = int(np.count_nonzero(water_mask & (delta[:, :, 0] > 20)))
                    if changed < 1024 or reflected < 64 or field.snapshot().to_dict()['tick'] != expected['endTick']:
                        raise ValueError('Water optics expired before measurement ended')
                    water_proof = {'changedWaterCells': changed, 'reflectedRedWaterCells': reflected,
                                   'lighting': False, 'bloom': False, 'refraction': False, 'haze': False, 'distortion': False}
                    write_png(output / 'native-water-final-isolated.png', wet, 1920, 1080)
                    write_png(output / 'native-water-final-off.png', dry, 1920, 1080)
                    if state_hash(field) != final_hash or field.energy_balance().drift_q != 0:
                        raise ValueError('Water proof mutated physics')
                haze_proof = {}
                if scene == 'haze' and mode == 'styled':
                    renderer.render(field, bloom=False, water=False, distortion=False)
                    lit = renderer.read_pixels()
                    renderer.render(field, lighting=False, bloom=False, water=False, distortion=False)
                    dark = renderer.read_pixels()
                    a = np.frombuffer(lit, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    b = np.frombuffer(dark, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    centers = ((np.arange(256) + .5) * 1080 / 256).astype(int)
                    red = a[centers[:, None], centers[None, :] + 420, 0] - b[centers[:, None], centers[None, :] + 420, 0]
                    materials = field.grid.reshape(256, 256) & 255
                    smoke_lit = int(np.count_nonzero((materials == MAT_SMOKE) & (red > 20)))
                    steam_lit = int(np.count_nonzero((materials == MAT_STEAM) & (red > 20)))
                    if smoke_lit < 64 or steam_lit < 64:
                        raise ValueError('Lit haze expired before measurement ended')
                    haze_proof = {'litSmokeCells': smoke_lit, 'litSteamCells': steam_lit, 'redGainThreshold': 20,
                                  'bloom': False, 'water': False, 'distortion': False, 'lightingComparison': [True, False]}
                    write_png(output / 'native-haze-final-isolated.png', lit, 1920, 1080)
                    write_png(output / 'native-haze-final-unlit.png', dark, 1920, 1080)
                    if state_hash(field) != final_hash or field.energy_balance().drift_q != 0:
                        raise ValueError('Haze proof mutated physics')
                heat_proof = {}
                if scene == 'heat' and mode == 'styled':
                    renderer.render(field, bloom=False, water=False)
                    shimmer = renderer.read_pixels()
                    renderer.render(field, bloom=False, water=False, distortion=False)
                    steady = renderer.read_pixels()
                    a = np.frombuffer(shimmer, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    b = np.frombuffer(steady, dtype=np.uint8).reshape(1080, 1920, 4).astype(np.int16)
                    centers = ((np.arange(256) + .5) * 1080 / 256).astype(int)
                    delta = np.max(np.abs(a[centers[:, None], centers[None, :] + 420, :3] - b[centers[:, None], centers[None, :] + 420, :3]), axis=2)
                    materials = field.grid.reshape(256, 256) & 255
                    open_mask = np.isin(materials, [0, 4, 9, 14, 15])
                    changed = int(np.count_nonzero(open_mask & (delta > 2)))
                    solid_changed = int(np.count_nonzero(~open_mask & (delta != 0)))
                    if changed < 64 or solid_changed:
                        raise ValueError('Heat shimmer expired or distorted opaque terrain')
                    heat_proof = {'changedOpenCells': changed, 'changedOpaqueCells': solid_changed,
                                  'rgbThreshold': 2, 'lighting': True, 'bloom': False, 'water': False}
                    write_png(output / 'native-heat-final-isolated.png', shimmer, 1920, 1080)
                    write_png(output / 'native-heat-final-off.png', steady, 1920, 1080)
                    if state_hash(field) != final_hash or field.energy_balance().drift_q != 0:
                        raise ValueError('Heat proof mutated physics')
                rows.append({'scene': scene, 'mode': mode, 'width': 256, 'height': 256, 'output': [1920, 1080],
                    'ticks': warmup + samples if scene == 'pressure' else samples, 'warmup': 0 if scene == 'pressure' else warmup,
                    'frameMs': distribution(frames), 'physicsMs': distribution(physics),
                    'renderingMs': distribution(rendering), 'overBudget': sum(value > 1000 / 60 for value in frames),
                    'endTick': field.tick, 'finalHash': final_hash, 'finalLavaCells': final_lava_cells, 'finalWaterCells': final_water_cells,
                    'finalSmokeCells': final_smoke_cells, 'finalSteamCells': final_steam_cells,
                    'waterProof': water_proof, 'hazeProof': haze_proof, 'heatProof': heat_proof, 'cpuBrowserParity': True, 'renderIsolation': True,
                    'energyDriftQ': '0', 'lightingTogglePreservesState': True, 'waterTogglePreservesState': True,
                    'hazeTogglePreservesState': True, 'distortionTogglePreservesState': True, 'renderingAdapter': renderer.adapter_info})
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser-cli', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-locked', action='store_true', help='Fail after retaining results if any sustained browser scene misses the 60 Hz deadline gate')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    started_at = datetime.now(timezone.utc).isoformat()
    before = source_hashes()
    commands = []
    prefix = [shutil.which('node'), str(args.browser_cli)] if args.browser_cli.suffix in ('.js', '.mjs') else [str(args.browser_cli)]
    session = 'state-space-frames-' + uuid.uuid4().hex[:12]

    def cli(*arguments, stdin=None):
        command = [*prefix, '--session', session, '--json', *arguments]
        code, stdout, stderr = run_captured(command, stdin=stdin)
        commands.append({'command': command, 'exitCode': code, 'stderr': stderr})
        result = json.loads(stdout) if stdout else {}
        if code or result.get('success') is not True:
            raise RuntimeError(f'Browser operation failed: {stdout}\n{stderr}')
        return result['data']

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_address[1]}/web/'
    try:
        cli('open', url + '?paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('eval', '--stdin', stdin='(async () => { window.__initial = await window.stateSpace.snapshot(); return "saved"; })()')
        cli('screenshot', str((args.output / 'browser-styled.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Lighting + shadows: on')
        cli('wait', '--fn', 'document.getElementById("light-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-unlit.png').resolve()))
        lights_ui = cli('eval', '--stdin', stdin='(async () => JSON.stringify(window.__initial) === JSON.stringify(await window.stateSpace.snapshot()))()')['result']
        if lights_ui is not True:
            raise ValueError('Lighting button changed simulation state')
        cli('find', 'role', 'button', 'click', '--name', 'Lighting + shadows: off')
        cli('find', 'role', 'button', 'click', '--name', 'B · Material + light')
        cli('wait', '--fn', 'document.getElementById("view-toggle").textContent.startsWith("A")')
        cli('screenshot', str((args.output / 'browser-plain.png').resolve()))
        ui = cli('eval', '--stdin', stdin='(async () => JSON.stringify(window.__initial) === JSON.stringify(await window.stateSpace.snapshot()))()')['result']
        if ui is not True:
            raise ValueError('A/B button changed simulation state')
        cli('find', 'role', 'button', 'click', '--name', 'A · Plain materials')
        cli('eval', '--stdin', stdin='(async () => { await window.stateSpace.step(48); return "stepped"; })()')
        cli('screenshot', str((args.output / 'browser-burning.png').resolve()))
        cli('open', url + '?scene=lighting&paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('screenshot', str((args.output / 'browser-gallery.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Lighting + shadows: on')
        cli('wait', '--fn', 'document.getElementById("light-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-gallery-unlit.png').resolve()))
        cli('open', url + '?scene=water&paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('eval', '--stdin', stdin='(async () => { window.__initial = await window.stateSpace.snapshot(); return "saved"; })()')
        cli('screenshot', str((args.output / 'browser-water.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Water optics: on')
        cli('wait', '--fn', 'document.getElementById("water-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-water-off.png').resolve()))
        water_ui = cli('eval', '--stdin', stdin='(async () => JSON.stringify(window.__initial) === JSON.stringify(await window.stateSpace.snapshot()))()')['result']
        if water_ui is not True:
            raise ValueError('Water button changed simulation state')
        cli('find', 'role', 'button', 'click', '--name', 'Water optics: off')
        cli('eval', '--stdin', stdin='(async () => { await window.stateSpace.step(132); return "stepped"; })()')
        cli('screenshot', str((args.output / 'browser-water-final.png').resolve()))
        cli('open', url + '?scene=haze&paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('eval', '--stdin', stdin='(async () => { window.__initial = await window.stateSpace.snapshot(); return "saved"; })()')
        cli('screenshot', str((args.output / 'browser-haze.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Volumetric haze: on')
        cli('wait', '--fn', 'document.getElementById("haze-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-haze-off.png').resolve()))
        haze_ui = cli('eval', '--stdin', stdin='(async () => JSON.stringify(window.__initial) === JSON.stringify(await window.stateSpace.snapshot()))()')['result']
        if haze_ui is not True:
            raise ValueError('Haze button changed simulation state')
        cli('find', 'role', 'button', 'click', '--name', 'Volumetric haze: off')
        cli('find', 'role', 'button', 'click', '--name', 'Lighting + shadows: on')
        cli('wait', '--fn', 'document.getElementById("light-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-haze-unlit.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Lighting + shadows: off')
        cli('eval', '--stdin', stdin='(async () => { await window.stateSpace.step(132); return "stepped"; })()')
        cli('screenshot', str((args.output / 'browser-haze-final.png').resolve()))
        cli('open', url + '?scene=heat&paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('eval', '--stdin', stdin='(async () => { window.__initial = await window.stateSpace.snapshot(); return "saved"; })()')
        cli('screenshot', str((args.output / 'browser-heat.png').resolve()))
        cli('find', 'role', 'button', 'click', '--name', 'Heat shimmer: on')
        cli('wait', '--fn', 'document.getElementById("distortion-toggle").getAttribute("aria-pressed") === "false"')
        cli('screenshot', str((args.output / 'browser-heat-off.png').resolve()))
        distortion_ui = cli('eval', '--stdin', stdin='(async () => JSON.stringify(window.__initial) === JSON.stringify(await window.stateSpace.snapshot()))()')['result']
        if distortion_ui is not True:
            raise ValueError('Heat shimmer button changed simulation state')
        cli('find', 'role', 'button', 'click', '--name', 'Heat shimmer: off')
        cli('eval', '--stdin', stdin='(async () => { await window.stateSpace.step(132); return "stepped"; })()')
        cli('screenshot', str((args.output / 'browser-heat-final.png').resolve()))
        cli('open', url + '?scene=pressure&paused')
        cli('wait', '--fn', 'Boolean(window.stateSpace)')
        cli('screenshot', str((args.output / 'browser-pressure.png').resolve()))
        cli('eval', '--stdin', stdin='(async () => { await window.stateSpace.step(60); return "stepped"; })()')
        cli('screenshot', str((args.output / 'browser-pressure-final.png').resolve()))
        cli('open', url + 'benchmark.html')
        deadline, seen = time.monotonic() + 600, ''
        while True:
            state = cli('eval', '({done:window.frameBenchmark?.done,error:window.frameBenchmark?.error,progress:document.getElementById("status").textContent})')['result']
            if state['progress'] != seen:
                seen = state['progress']
                print('Browser frame benchmark:', seen, flush=True)
            if state.get('done'):
                if state.get('error'):
                    raise RuntimeError(state['error'])
                browser = cli('eval', 'window.frameBenchmark.result')['result']
                break
            if time.monotonic() > deadline:
                raise TimeoutError('Frame benchmark did not finish')
            time.sleep(5)
        errors = cli('errors').get('errors', [])
        if errors:
            raise RuntimeError(f'Browser errors: {errors}')
        cli('close')
        native = native_frames(args.output, browser)
        native_paced = []
        initial_scenes = json.loads((args.output / 'initial-scenes.json').read_text())
        for row in browser['pacedScenes']:
            print('Native long replay:', row['scene'], row['endTick'], flush=True)
            with create_field(256, 256) as field:
                field.restore(initial_scenes[row['scene']])
                field.step(row['endTick'])
                if state_hash(field) != row['finalHash'] or field.energy_balance().drift_q != 0:
                    raise ValueError('Long browser/native/CPU replay differs')
                native_paced.append({'scene': row['scene'], 'endTick': field.tick, 'finalHash': state_hash(field),
                                     'cpuBrowserParity': True, 'energyDriftQ': '0'})
        if source_hashes() != before:
            raise ValueError('Sources changed during frame measurements')
        report = {'reportVersion': 7, 'startedAt': started_at, 'finishedAt': datetime.now(timezone.utc).isoformat(),
            'sourceHashes': before, 'sourceUnchangedDuringBenchmark': True,
            'runtime': {'python': sys.version, 'wgpu': wgpu.__version__},
            'browserBundleHash': digest(ROOT / 'dist/sdk/state-space.js'), 'browserCliHash': digest(args.browser_cli),
            'uiTogglePreservesState': ui, 'lightingTogglePreservesState': lights_ui, 'waterTogglePreservesState': water_ui,
            'hazeTogglePreservesState': haze_ui,
            'distortionTogglePreservesState': distortion_ui,
            'commands': commands, 'browser': browser, 'native': native, 'nativePacedReplays': native_paced,
            'locked60': browser['locked60'],
            'scope': 'GPU-completed full frame work, including physics, renderer copies/uploads, gas density reconstruction, volumetric extinction/scattering and heat plume reconstruction/distortion. Native is offscreen; browser includes a separate display-paced run. OS scanout, startup and capture readbacks excluded.'}
        (args.output / 'frames.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        print('Report:', args.output / 'frames.json', flush=True)
        print('All sustained browser scenes meet the 60 Hz gate:', browser['locked60'], flush=True)
        return int(args.require_locked and not browser['locked60'])
    except Exception as error:
        failure = {'startedAt': started_at, 'failedAt': datetime.now(timezone.utc).isoformat(),
                   'sourceHashes': before, 'sourceUnchangedDuringBenchmark': source_hashes() == before,
                   'error': str(error), 'commands': commands}
        (args.output / 'failure.json').write_text(json.dumps(failure, indent=2) + '\n', encoding='utf-8')
        raise
    finally:
        try:
            cli('close')
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    raise SystemExit(main())
