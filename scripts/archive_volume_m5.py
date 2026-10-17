"""Retain completed M5 receipts; metadata/file copying only, no workloads."""
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent


def main():
    source=ROOT/'dist/volume-m5/recovery'
    destination=ROOT/'docs/checkpoints/volume-m5/development'
    foundation=json.loads((ROOT/'docs/checkpoints/volume-m5/foundation/index.json').read_text())
    existing={item['id'] for item in foundation['records']}
    records=[]
    for stage in sorted(source.iterdir()):
        if not stage.is_dir() or stage.name in existing or not (stage/'report.json').is_file():
            continue
        receipt=json.loads((stage/'report.json').read_text())
        files={}
        for original in sorted(stage.rglob('*')):
            if not original.is_file(): continue
            # Keep the inspected UI image once. Raw timing/state receipts for
            # every successful or failed frame run are retained in full.
            if original.suffix=='.png' and not stage.name.startswith('ui-pilot-'): continue
            relative=original.relative_to(stage);target=destination/stage.name/relative
            digest=hashlib.sha256(original.read_bytes()).hexdigest()
            if target.exists():
                if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
                    raise ValueError(f'An archived receipt changed: {target}')
            else:
                target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,target)
            if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
                raise ValueError('Archive copy differs')
            files[relative.as_posix()]=digest
        records.append({'id':stage.name,'stage':receipt['stage'],'passed':receipt['passed'],
            'originalDirectory':stage.relative_to(ROOT).as_posix(),
            'archivedDirectory':(destination/stage.name).relative_to(ROOT).as_posix(),'files':files})
    destination.mkdir(parents=True,exist_ok=True)
    index={'scope':'M5 implementation evidence, including failed attempts. Individual passes do not establish release completion.',
        'acceptanceReport':'../release-audit.json','legacyDemosQuarantined':True,'incidentHoldRemainsActive':(ROOT/'dist/verification/safety-hold.json').exists(),'records':records}
    (destination/'index.json').write_text(json.dumps(index,indent=2)+'\n',encoding='utf8')
    print(json.dumps({'records':len(records),'files':sum(len(r['files']) for r in records),'index':str(destination/'index.json')}))


if __name__=='__main__': main()
