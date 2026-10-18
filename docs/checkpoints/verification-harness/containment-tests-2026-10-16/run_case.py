import ctypes
from ctypes import wintypes as W
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path.cwd()
OUT = ROOT / 'docs/checkpoints/verification-harness/containment-tests-2026-10-16'
CASES = (
 'test_contained_success',
 'test_second_verification_never_starts',
 'test_timeout_kills_descendants',
 'test_independent_watchdog_survives_blocked_receipt_writer',
)
PROTECTED = {
 'dist/verification/safety-hold.json': '3444c8e505e3dd47bfacecfcc4411b8ca1196c818600044d375481f235610f5b',
 'scripts/verify_checks.mjs': 'b3ef0acf0af83786865b70664f144adf2f2f65452a7764cadd97a966333bcfaf',
}
def protected():
 hashes = {p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in PROTECTED}
 if hashes != PROTECTED:
  raise RuntimeError('Hold or legacy gate changed; stop')
 hold = json.loads((ROOT/'dist/verification/safety-hold.json').read_bytes())
 if hold.get('blockRecovery') is not True or 'recoveryPermit' in hold:
  raise RuntimeError('Runtime hold must remain intact')
 return hashes

def child(case, dest):
 import unittest
 sys.path.insert(0,str(ROOT/'tests'))
 import test_verification_guard as tests
 original = tests.VerificationGuardTests.run_guard
 def retained(self, folder, *args, **kwargs):
  try:
   return original(self, folder, *args, **kwargs)
  finally:
   for name in ('report.json', 'stdout.log', 'stderr.log', 'telemetry.jsonl', 'report.tmp'):
    path = folder/name
    if path.exists():
     if path.stat().st_size > 1024*1024:
      raise RuntimeError('Unexpected containment evidence size')
     shutil.copyfile(path, dest/name)
 tests.VerificationGuardTests.run_guard = retained
 suite = unittest.TestSuite([tests.VerificationGuardTests(case)])
 result = unittest.TextTestRunner(verbosity=2).run(suite)
 info = {'testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),
         'skipped':len(result.skipped),'passed':result.wasSuccessful() and not result.skipped}
 (dest/'unittest.json').write_text(json.dumps(info,indent=2)+'\n',encoding='utf-8')
 return 0 if info['passed'] else 1

def process_state(pid):
 # Query/synchronize only. This observer never terminates or contains a process.
 kernel = ctypes.WinDLL('kernel32',use_last_error=True)
 kernel.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD]
 kernel.OpenProcess.restype=W.HANDLE
 kernel.GetExitCodeProcess.argtypes=[W.HANDLE,ctypes.POINTER(W.DWORD)]
 kernel.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD]
 kernel.WaitForSingleObject.restype=W.DWORD
 kernel.CloseHandle.argtypes=[W.HANDLE]
 handle=kernel.OpenProcess(0x1000|0x100000,False,pid)
 if not handle:
  error=ctypes.get_last_error()
  if error==87:
   return {'pid':pid,'state':'absent'}
  raise ctypes.WinError(error)
 try:
  waited=kernel.WaitForSingleObject(handle,0)
  code=W.DWORD()
  if not kernel.GetExitCodeProcess(handle,ctypes.byref(code)):
   raise ctypes.WinError(ctypes.get_last_error())
  return {'pid':pid,'state':'exited' if waited==0 else 'running' if waited==258 else 'unknown',
          'exitCode':code.value}
 finally:
  kernel.CloseHandle(handle)

def main(case):
 before=protected()
 index=CASES.index(case)
 OUT.mkdir(parents=True,exist_ok=True)
 for previous in CASES[:index]:
  receipt=json.loads((OUT/previous/'case.json').read_text())
  if receipt.get('passed') is not True:
   raise RuntimeError('Preceding case did not pass; do not continue')
 dest=OUT/case
 dest.mkdir(exist_ok=False)
 source_paths=['scripts/verification_guard.py','scripts/verification_watchdog.py',
               'scripts/verification_health.py','scripts/verification_journal.py',
               'tests/test_verification_guard.py']
 source_hashes={p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in source_paths}
 env=dict(os.environ)
 for name in ('STATE_SPACE_VERIFICATION_JOB','STATE_SPACE_RUN_LEGACY_DEMOS','NODE_OPTIONS'):
  env.pop(name,None)
 env.update(STATE_SPACE_TEST_CONTAINMENT='reviewed-non-gpu',
            PYTHONDONTWRITEBYTECODE='1',PYTHONIOENCODING='utf-8',
            OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1')
 command=[sys.executable,'-B',str(Path(__file__).resolve()),'--child',case,str(dest)]
 receipt={'case':case,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'passed':False,'command':command,'sourceHashes':source_hashes,
          'protectedBefore':before,'wrapperTimeoutSeconds':25,
          'testSupervisorTimeoutSeconds':15,'containmentOptIn':'child-process-only',
          'legacyOptIn':False,'python':sys.version,'workload':'print/sleep only',
          'hostHealth':'fixture values; no GPU telemetry'}
 (dest/'case.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
 begin=time.monotonic()
 try:
  result=subprocess.run(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
          timeout=25,creationflags=subprocess.CREATE_NO_WINDOW|subprocess.BELOW_NORMAL_PRIORITY_CLASS)
  stdout,stderr=result.stdout,result.stderr
  receipt['exitCode']=result.returncode
  receipt['passed']=result.returncode==0
 except subprocess.TimeoutExpired as error:
  stdout,stderr=error.stdout or b'',error.stderr or b''
  receipt['timedOut']=True
 receipt['wallSeconds']=round(time.monotonic()-begin,4)
 (dest/'test.stdout.log').write_bytes(stdout)
 (dest/'test.stderr.log').write_bytes(stderr)
 receipt['protectedAfter']=protected()
 receipt['protectedUnchanged']=receipt['protectedAfter']==before
 if (dest/'report.json').exists():
  report=json.loads((dest/'report.json').read_bytes())
  receipt['supervisor']={k:report[k] for k in
    ('id','childPid','exitCode','passed','error','cleanupError','independentWatchdog','startedAt','finishedAt') if k in report}
  pids=[]
  if report.get('childPid'): pids.append(report['childPid'])
  if case=='test_timeout_kills_descendants' and (dest/'stdout.log').exists():
   text=(dest/'stdout.log').read_text().strip()
   if text.isdigit(): pids.append(int(text))
  receipt['observedProcesses']=[process_state(pid) for pid in pids]
  if any(row['state'] not in ('exited','absent') for row in receipt['observedProcesses']):
   receipt['passed']=False
   receipt['cleanupFailure']='Owned workload process still running or unqueryable'
 else:
  receipt['passed']=False
  receipt['missingSupervisorReceipt']=True
 receipt['evidenceHashes']={p.name:hashlib.sha256(p.read_bytes()).hexdigest()
                             for p in dest.iterdir() if p.is_file() and p.name!='case.json'}
 (dest/'case.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
 print(stdout.decode('utf-8','replace'))
 print(stderr.decode('utf-8','replace'))
 print(json.dumps({k:receipt[k] for k in ('case','passed','wallSeconds','protectedUnchanged','supervisor','observedProcesses') if k in receipt}))
 return 0 if receipt['passed'] else 1

if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--child':
  raise SystemExit(child(sys.argv[2],Path(sys.argv[3])))
 if len(sys.argv)!=2 or sys.argv[1] not in CASES:
  raise SystemExit('Choose one allowlisted containment case')
 raise SystemExit(main(sys.argv[1]))

