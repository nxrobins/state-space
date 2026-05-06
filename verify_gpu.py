"""
Verify wgpu works on the system GPU.
Dispatches a simple compute shader that doubles each element of a buffer.
"""

import wgpu
import numpy as np


def main():
    # Request GPU adapter
    adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
    if adapter is None:
        print("FAIL: No GPU adapter found")
        return False

    info = adapter.info
    print(f"GPU Adapter: {info.get('device', info.get('adapter_type', 'unknown'))}")
    print(f"  Vendor:      {info.get('vendor', 'unknown')}")
    print(f"  Architecture: {info.get('architecture', 'unknown')}")
    print(f"  Description: {info.get('description', str(info))}")

    # Request device
    device = adapter.request_device_sync()
    print(f"Device created successfully")

    # Simple compute shader: doubles each u32 in the buffer
    shader_code = """
    @group(0) @binding(0) var<storage, read_write> data: array<u32>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let idx = gid.x;
        if (idx < arrayLength(&data)) {
            data[idx] = data[idx] * 2u;
        }
    }
    """

    # Create test data
    N = 1024
    input_data = np.arange(N, dtype=np.uint32)
    expected = input_data * 2

    # Create GPU buffer
    buf = device.create_buffer_with_data(
        data=input_data.tobytes(),
        usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
    )

    # Create shader module
    shader = device.create_shader_module(code=shader_code)

    # Create compute pipeline
    bind_group_layout = device.create_bind_group_layout(
        entries=[{
            "binding": 0,
            "visibility": wgpu.ShaderStage.COMPUTE,
            "buffer": {"type": wgpu.BufferBindingType.storage},
        }]
    )
    pipeline_layout = device.create_pipeline_layout(
        bind_group_layouts=[bind_group_layout]
    )
    pipeline = device.create_compute_pipeline(
        layout=pipeline_layout,
        compute={"module": shader, "entry_point": "main"},
    )

    # Create bind group
    bind_group = device.create_bind_group(
        layout=bind_group_layout,
        entries=[{"binding": 0, "resource": {"buffer": buf, "offset": 0, "size": buf.size}}],
    )

    # Dispatch compute
    encoder = device.create_command_encoder()
    compute_pass = encoder.begin_compute_pass()
    compute_pass.set_pipeline(pipeline)
    compute_pass.set_bind_group(0, bind_group)
    compute_pass.dispatch_workgroups((N + 63) // 64)
    compute_pass.end()

    device.queue.submit([encoder.finish()])

    # Read result directly from storage buffer
    result = np.frombuffer(device.queue.read_buffer(buf), dtype=np.uint32)

    if np.array_equal(result, expected):
        print(f"\nCOMPUTE TEST PASSED: {N} elements doubled correctly on GPU")
        return True
    else:
        mismatches = np.sum(result != expected)
        print(f"\nCOMPUTE TEST FAILED: {mismatches}/{N} mismatches")
        return False


if __name__ == "__main__":
    success = main()
    if not success:
        exit(1)
