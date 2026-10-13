import json, time, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from scripts.verify_browser import run_captured
prefix = ['node', 'C:/Users/nxrob/AppData/Local/npm-cache/_npx/ba0727cbf2d10686/node_modules/agent-browser/bin/agent-browser.js', '--session', 'pressure-stages', '--json']
def cli(*args):
    code,out,err=run_captured([*prefix,*args]); result=json.loads(out)
    if code or not result.get('success'): raise RuntimeError(out+err)
    return result['data']
folder=Path(__file__).resolve().parent
tracing=False
try:
    cli('open','http://127.0.0.1:8765/dist/performance/pacing-probe/stages.html')
    seen=''
    for _ in range(120):
        state=cli('eval','({done:window.probe?.done,error:window.probe?.error,progress:document.getElementById("status").textContent})')['result']
        if state['progress'] != seen:
            seen=state['progress']; print(seen,flush=True)
        if 'pacing' in seen and not tracing:
            cli('profiler','start','--categories','devtools.timeline,v8.execute,blink.user_timing,toplevel,gpu,v8,disabled-by-default-v8.gc')
            tracing=True
        if state.get('done'): break
        time.sleep(5)
    else: raise TimeoutError('Stages')
    data=cli('eval','window.probe')['result']
    (folder/'stages-traced.json').write_text(json.dumps(data,indent=2)+'\n')
    if data.get('error'): raise RuntimeError(data['error'])
    print('Done',data['result']['locked60'],flush=True)
finally:
    if tracing: cli('profiler','stop',str(folder/'stages-trace.json'))
    cli('close')
