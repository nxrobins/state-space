import json, sys, statistics
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
import wgpu, numpy as np
from engine import create_field, MaterialRenderer
adapter=wgpu.gpu.request_adapter_sync(power_preference="high-performance")
adapter_type=type(adapter); request=adapter_type.request_device_sync
names=['material','density','sources','lighting','haze','water-spans','optics','bloom-x','bloom-y','heat','present']
initial=json.loads(Path('docs/checkpoints/pressure-pacing-frames/initial-scenes.json').read_text())
results=[]
for scene in initial:
 with create_field(256,256) as field:
  field.restore(initial[scene]); field.step(60)
  with patch.object(adapter_type, 'request_device_sync', lambda self, **kw: request(self, required_features=['timestamp-query'], **kw)):
   renderer=MaterialRenderer(256,256)
  device=renderer.device; qs=device.create_query_set(type='timestamp',count=32)
  resolve=device.create_buffer(size=256,usage=wgpu.BufferUsage.QUERY_RESOLVE|wgpu.BufferUsage.COPY_SRC)
  enc_type=type(device.create_command_encoder()); begin_render=enc_type.begin_render_pass; begin_compute=enc_type.begin_compute_pass; finish=enc_type.finish
  counter=[0]
  def stamp(original):
   def begin(enc,*args,**kwargs):
    i=counter[0]; counter[0]+=2
    return original(enc,*args,**kwargs,timestamp_writes={'query_set':qs,'beginning_of_pass_write_index':i,'end_of_pass_write_index':i+1})
   return begin
  def finished(enc,*args,**kwargs):
   enc.resolve_query_set(qs,0,counter[0],resolve,0)
   return finish(enc,*args,**kwargs)
  samples=[]
  with patch.object(enc_type,'begin_render_pass',stamp(begin_render)), patch.object(enc_type,'begin_compute_pass',stamp(begin_compute)), patch.object(enc_type,'finish',finished):
   for i in range(24):
    counter[0]=0; renderer.render(field)
    values=np.frombuffer(device.queue.read_buffer(resolve),dtype=np.uint64)
    if i>=4: samples.append([(int(values[j+1])-int(values[j]))/1e6 for j in range(0,counter[0],2)])
  row={'scene':scene,'passes':{name:{'median':statistics.median(s[j] for s in samples),'max':max(s[j] for s in samples)} for j,name in enumerate(names)},'samples':samples}
  results.append(row); print(scene, json.dumps(row['passes']),flush=True)
  qs.destroy(); resolve.destroy(); del qs,resolve,device
  renderer.close()
Path(sys.argv[1]).write_text(json.dumps(results,indent=2)+'\n')
