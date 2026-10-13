import gc, json, sys, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]))
from engine import create_field, MaterialRenderer
import engine.compositor as compositor
import wgpu.backends.wgpu_native as native

now=time.perf_counter
events=[]
def collect(phase,info): events.append((now(),phase,dict(info)))
gc.callbacks.append(collect)
stages=[]
def wrap(owner,name):
    original=getattr(owner,name)
    def measured(*args,**kwargs):
        start=now()
        try: return original(*args,**kwargs)
        finally: stages.append((name,start,now()))
    setattr(owner,name,measured)
for owner,name in [(compositor,'_transport_validated'),(compositor,'validate_structure_compiled'),
                   (compositor,'_ledger_validated'),(native.GPUBuffer,'map_sync'),(native.GPUQueue,'submit')]: wrap(owner,name)
scenes=json.loads(Path('docs/checkpoints/pressure-merged-frames/initial-scenes.json').read_text())
rows=[]
for scene in ('bridge','emissive','lighting'):
    for mode in ('plain','styled','alternating'):
        with create_field(256,256) as field, MaterialRenderer(256,256) as renderer:
            field.restore(scenes[scene])
            for options in ({'styled':False},{},{'lighting':False},{'water':False},{'haze':False},{'distortion':False}):
                renderer.render(field,**options); renderer.read_pixels()
            for i in range(132):
                stages=[]; events=[]; start=now()
                field.step(1); physics=now()
                renderer.render(field,styled=mode=='styled' or (mode=='alternating' and i%2==0))
                end=now()
                rows.append(dict(scene=scene,mode=mode,tick=i+1,physics=(physics-start)*1000,rendering=(end-physics)*1000,
                                 stages=[(n,(a-start)*1000,(b-a)*1000) for n,a,b in stages],gc=events))
        print(scene,mode,'max physics',max(r['physics'] for r in rows if r['scene']==scene and r['mode']==mode),flush=True)
Path('dist/performance/pacing-probe/native-stages.json').write_text(json.dumps(rows,indent=2)+'\n')
