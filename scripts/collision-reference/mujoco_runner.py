"""CPU-only MuJoCo 4 comparison. Importing this file does not import MuJoCo."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import sys
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def floats(values):
    return " ".join(format(v, ".17g") for v in values)


def model_xml(scene, dt, protocol, speculative):
    """Explicit cuboid inertia, world-fixed obstacles, zero fluid/actuator effects."""
    config = protocol["mujoco"]
    root = ET.Element("mujoco", model=scene["id"])
    ET.SubElement(root, "compiler", angle="radian")
    option = ET.SubElement(root, "option", timestep=format(dt, ".17g"),
                           gravity=floats(scene["gravity"]), integrator=config["integrator"],
                           solver=config["solver"], iterations=str(config["iterations"]),
                           tolerance=str(config["tolerance"]))
    ET.SubElement(option, "flag", speculative="enable" if speculative else "disable",
                  sleep="disable", warmstart="enable", autoreset="disable")
    default = ET.SubElement(root, "default")
    ET.SubElement(default, "geom", type="box", condim="3", margin="0", gap="0",
                  friction=floats([scene["friction"], 0, 0]),
                  solref=floats(config["solref"]), solimp=floats(config["solimp"]))
    world = ET.SubElement(root, "worldbody")
    for b in scene["bodies"]:
        q = b["orientation"]
        parent = ET.SubElement(world, "body", name=b["id"], pos=floats(b["center"]),
                               quat=floats([q[3], q[0], q[1], q[2]]))
        if not b["fixed"]:
            ET.SubElement(parent, "freejoint", name=b["id"] + "_joint")
            h, mass = b["halfExtents"], b["mass"]
            inertia = [mass * (h[(i + 1) % 3] ** 2 + h[(i + 2) % 3] ** 2) / 3 for i in range(3)]
            ET.SubElement(parent, "inertial", pos="0 0 0", mass=str(mass), diaginertia=floats(inertia))
        ET.SubElement(parent, "geom", name=b["id"] + "_geom", size=floats(b["halfExtents"]))
    return ET.tostring(root, encoding="unicode")


def distribution_fingerprint(name):
    distribution = importlib.metadata.distribution(name)
    digests = []
    for file in sorted(distribution.files or [], key=str):
        path = distribution.locate_file(file)
        if path.is_file() and path.suffix != ".pyc":
            digests.append([str(file), hashlib.sha256(path.read_bytes()).hexdigest()])
    return {"name": name, "version": distribution.version, "files": digests}


def run_case(mj, np, scene, dt, protocol, speculative, evidence):
    xml = model_xml(scene, dt, protocol, speculative)
    evidence["modelXml"] = xml
    model = mj.MjModel.from_xml_string(xml)
    enable = int(mj.mjtEnableBit.mjENBL_SPECULATIVE)
    if bool(int(model.opt.enableflags) & enable) != speculative:
        raise RuntimeError("Speculative flag did not bind")
    if int(model.opt.enableflags) & int(mj.mjtEnableBit.mjENBL_SLEEP):
        raise RuntimeError("Sleeping must remain disabled")
    spec = int(mj.mjtState.mjSTATE_INTEGRATION)
    size = mj.mj_stateSize(model, spec)
    ticks = round(protocol["duration"] / dt)
    if not 3 <= ticks <= protocol["maxTicks"]:
        raise RuntimeError("Invalid timestep horizon")

    def capture(data):
        state = np.empty(size, dtype=np.float64)
        mj.mj_getState(model, data, state, spec)
        if not np.isfinite(state).all():
            raise RuntimeError("Nonfinite MuJoCo integration state")
        return state.astype("<f8").tobytes().hex()

    def fresh():
        data = mj.MjData(model)
        for body in scene["bodies"]:
            if body["fixed"]:
                continue
            if body["orientation"] != [0, 0, 0, 1]:
                raise RuntimeError("Initial local angular velocity mapping requires identity orientation")
            joint = mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT, body["id"] + "_joint")
            at = model.jnt_dofadr[joint]
            data.qvel[at:at + 3] = body["velocity"]
            data.qvel[at + 3:at + 6] = body["angularVelocity"]
        mj.mj_forward(model, data)
        return data

    def trajectory(start=None, start_tick=0):
        data = fresh()
        if start is not None:
            saved = np.frombuffer(bytes.fromhex(start), dtype="<f8").astype(np.float64)
            if len(saved) != size:
                raise RuntimeError("Wrong checkpoint size")
            mj.mj_setState(model, data, saved, spec)
            if capture(data) != start:
                raise RuntimeError("MuJoCo checkpoint changed during restore")
        states, frames, elapsed = [], [], 0.0
        evidence["activeTrajectory"] = {"startTick": start_tick, "states": states, "trajectory": frames}
        for tick in range(start_tick, ticks):
            before = time.perf_counter_ns()
            mj.mj_step(model, data)
            elapsed += (time.perf_counter_ns() - before) / 1e6
            if any(int(w.number) for w in data.warning):
                raise RuntimeError("MuJoCo warning; sample retained as failed")
            states.append(capture(data))
            # mj_step leaves position-derived fields at the pre-integration pose.
            # Read qpos/qvel directly; no extra forward solve can alter continuation.
            bodies, mechanical = [], 0.0
            for b in scene["bodies"]:
                if b["fixed"]:
                    position, velocity, q, omega = b["center"], [0., 0., 0.], b["orientation"], [0., 0., 0.]
                else:
                    joint = mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT, b["id"] + "_joint")
                    pos, vel = model.jnt_qposadr[joint], model.jnt_dofadr[joint]
                    position = data.qpos[pos:pos + 3].tolist()
                    velocity = data.qvel[vel:vel + 3].tolist()
                    wxyz = data.qpos[pos + 3:pos + 7].copy()
                    q = [float(wxyz[1]), float(wxyz[2]), float(wxyz[3]), float(wxyz[0])]
                    local_omega = data.qvel[vel + 3:vel + 6].copy()
                    world_omega = np.zeros(3)
                    mj.mju_rotVecQuat(world_omega, local_omega, wxyz)
                    omega = world_omega.tolist()
                    h = b["halfExtents"]
                    inertia = [b["mass"] * (h[(i + 1) % 3] ** 2 + h[(i + 2) % 3] ** 2) / 3 for i in range(3)]
                    mechanical += (0.5 * b["mass"] * sum(v * v for v in velocity)
                                   + 0.5 * sum(inertia[i] * float(local_omega[i]) ** 2 for i in range(3))
                                   - b["mass"] * sum(scene["gravity"][i] * position[i] for i in range(3)))
                bodies.append({"id": b["id"], "center": position, "velocity": velocity,
                               "orientation": q, "angularVelocity": omega})
            if not math.isfinite(mechanical):
                raise RuntimeError("Nonfinite observable")
            pairs = [{"a": mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM, int(contact.geom1)),
                      "b": mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM, int(contact.geom2)),
                      "distance": float(contact.dist)} for contact in data.contact]
            frames.append({"time": (tick + 1) * dt, "bodies": bodies,
                           "mechanicalEnergy": mechanical, "contacts": int(data.ncon),
                           "contactPairs": pairs, "contactSampling": "pre-integration"})
        return states, frames, elapsed

    reference, frames, _ = trajectory()
    evidence["reference"] = {"states": reference, "trajectory": frames}
    resumed, _, _ = trajectory(reference[1], 2)
    if resumed != reference[2:]:
        raise RuntimeError("MuJoCo integration-state continuation differs")
    samples = []
    evidence["completedSamplesMs"] = samples
    for sample in range(-protocol["warmups"], protocol["samples"]):
        evidence["sample"] = sample
        repeated, _, elapsed = trajectory()
        if repeated != reference:
            raise RuntimeError("MuJoCo repeat changed integration state")
        if sample >= 0:
            samples.append(elapsed)
    return {"status": "completed", "backend": "mujoco-speculative" if speculative else "mujoco-discrete",
            "scene": scene["id"], "dt": dt, "duration": protocol["duration"], "ticks": ticks,
            "modelXml": xml, "modelXmlSha256": hashlib.sha256(xml.encode()).hexdigest(),
            "integrationState": {"spec": spec, "size": size, "format": "little-endian-float64-hex", "frames": reference},
            "trajectory": frames, "samplesMs": samples,
            "replay": {"repeatExact": True, "integrationStateRestartExact": True, "sleeping": False},
            "contactLaw": "soft regularized contact; solref is not an exact restitution mapping",
            "physicalDissipation": None, "numericalEnergyResidual": None}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--packet", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT))
    from scripts.verification_guard import assert_runtime_not_blocked
    assert_runtime_not_blocked()
    if not os.environ.get("STATE_SPACE_VERIFICATION_JOB") or os.environ.get("STATE_SPACE_VERIFICATION_KIND") != "cpu":
        raise RuntimeError("MuJoCo entry requires the existing CPU supervisor")
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
        if os.environ.get(key) != "1":
            raise RuntimeError("Single-thread configuration is required")
    if args.output.exists():
        raise RuntimeError("Output already exists")
    packet_bytes = args.packet.read_bytes()
    expected = args.packet.with_name("packet.sha256").read_text().strip()
    if hashlib.sha256(packet_bytes).hexdigest() != expected:
        raise RuntimeError("Packet digest mismatch")
    packet = json.loads(packet_bytes)
    from_version = importlib.metadata.version("mujoco-core")
    if from_version != packet["protocol"]["mujocoVersion"]:
        raise RuntimeError("MuJoCo version must exactly match the pinned protocol")
    import numpy as np
    import mujoco as mj
    if np.__version__ != packet["protocol"]["numpyVersion"]:
        raise RuntimeError("NumPy version must exactly match the pinned protocol")
    if mj.__version__ != from_version or not hasattr(mj.mjtEnableBit, "mjENBL_SPECULATIVE"):
        raise RuntimeError("MuJoCo 4 speculative contact capability unavailable")
    report = {"schema": "collision-mujoco-result-v1", "packetSha256": expected,
              "environment": {"python": sys.version, "executable": sys.executable,
                              "executableSha256": hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
                              "platform": platform.platform(), "machine": platform.machine(),
                              "distributions": [distribution_fingerprint("mujoco-core"), distribution_fingerprint("numpy")]},
              "rows": [], "runtimeAcceptance": False, "performanceAcceptance": False}
    with args.output.open("x", encoding="utf-8") as output:
        for scene in packet["fixtures"]:
            for dt in packet["protocol"]["timesteps"]:
                for speculative in (False, True):
                    backend = "mujoco-speculative" if speculative else "mujoco-discrete"
                    print(json.dumps({"scene": scene["id"], "dt": dt, "backend": backend}), flush=True)
                    evidence = {}
                    try:
                        row = run_case(mj, np, scene, dt, packet["protocol"], speculative, evidence)
                    except Exception as error:
                        row = {"status": "failed", "scene": scene["id"], "dt": dt, "backend": backend,
                               "error": str(error), "partial": evidence, "timing": None}
                    report["rows"].append(row)
                    output.seek(0)
                    json.dump(report, output, allow_nan=False, indent=2)
                    output.truncate()
                    output.flush()
        os.fsync(output.fileno())
    return int(any(row["status"] != "completed" for row in report["rows"]))


if __name__ == "__main__":
    raise SystemExit(main())
