"""Serve the isolated game and an in-memory v1.9 simulator on one origin."""
import argparse
from copy import deepcopy
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

FAMILY='r5-selftest-coin-v19'
CATALOG={'tiger-kart': ('虎啸流星', 2000), 'monster-truck': ('雷霆巨兽', 4000)}
BASE='/coin-preview-r5/v1/racing/'


class DemoCloud:
    def __init__(self):
        self.lock=Lock()
        self.profiles={key:{'coins':coins,'owned':{},'current':'red','revision':6,'enabled':enabled,'events':[]}
                       for key,coins,enabled in [('shared',6500,True),('zero',0,True),('disabled',6500,False),
                                                 ('flaky',6500,True)]}
        self.lost=set()

    def call(self, route, headers, request):
        device=headers.get('x-r5-device','')
        alias=device.removeprefix('coin-v19-demo-')
        if device!=f'coin-v19-demo-{alias}' or alias not in ('a','b','zero','disabled','denied','flaky','offline','missing'):
            return 401,{'error':'R5_MEMBER_DENIED'}
        if alias=='missing': return 404,{'error':'R5_NOT_FOUND'}
        if alias=='offline': return 503,{'error':'R5_RACING_SAVE_UNAVAILABLE'}
        if alias=='denied':
            return 200,{'status':'DEVICE_NOT_AUTHORIZED','ok':False,'family_id':FAMILY,
                        'zero_write':True,'owned':{},'coins_balance':0,'catalog':[],
                        'revision':0,'coin_gate_enabled':False,'current_vehicle':'red'}
        profile=self.profiles['shared' if alias in ('a','b') else alias]
        with self.lock:
            return self.handle(profile,alias,route,request)

    def handle(self, data, alias, route, request):
        def catalog(ownership):
            return [{'vehicle_id':id,'display_name':name,'price':price,'currency':'coin',
                     'owned':ownership and id in data['owned']} for id,(name,price) in CATALOG.items()]
        def save():
            return {'family_id':FAMILY,'owned':deepcopy(data['owned']),'coins_balance':data['coins'],
                    'current_vehicle':data['current'],'revision':data['revision']}
        if route=='coin/catalog' and request=={}:
            return 200,{'status':'OK','ok':True,'family_id':FAMILY,'catalog':catalog(False)}
        if route=='coin/state' and request=={}:
            return 200,{'status':'OK','ok':True,**save(),'catalog':catalog(True),
                        'coin_gate_enabled':data['enabled'],'owned_coin_vehicles':list(data['owned'])}
        if route=='coin/purchase' and set(request)=={'vehicle_id'}:
            id=request['vehicle_id']
            if not isinstance(id,str) or id not in CATALOG:
                return 200,{'status':'VEHICLE_NOT_FOUND','ok':False,'zero_write':True,'deducted':0}
            price=CATALOG[id][1]
            before=data['coins']
            deducted=0
            if not data['enabled']:
                status='PURCHASE_DISABLED'
            elif id in data['owned']:
                status='ALREADY_OWNED'
            elif data['coins']<price:
                status='INSUFFICIENT_COINS'
            else:
                status='PURCHASED'
                deducted=price
                data['coins']-=price
                data['owned'][id]={'source':'coins','currency':'coin','price':price}
                data['events'].append('buy:'+id)
                data['revision']+=1
                if alias=='flaky' and id not in self.lost:
                    self.lost.add(id)
                    return 502,{'error':'DEMO_RESPONSE_LOST_AFTER_COMMIT'}
            ok=status in ('PURCHASED','ALREADY_OWNED')
            return 200,{'status':status,'ok':ok,'vehicle_id':id,'price':price,'deducted':deducted,
                        'deficit':max(0,price-data['coins']) if status=='INSUFFICIENT_COINS' else None,
                        'balance_before':before,'balance_after':data['coins'],'idempotency_key':'buy:'+id,
                        'zero_write':deducted==0,**save(),'save':save() if ok else None}
        if route=='save/sync' and set(request)=={'expected_revision','events','patch'} and request['events']==[]:
            if request['expected_revision']!=data['revision']:
                return 200,{'status':'REVISION_CONFLICT','revision':data['revision'],'zero_write':True}
            patch=request['patch']
            if not isinstance(patch,dict) or set(patch)!={'current_vehicle'}: return 400,{'error':'BAD_PATCH'}
            selected=patch['current_vehicle']
            if not isinstance(selected,str) or selected not in data['owned']:
                return 200,{'status':'APPLIED','save':save(),'warnings':['CURRENT_VEHICLE_NOT_OWNED']}
            if selected!=data['current']:
                data['current']=selected
                data['revision']+=1
            return 200,{'status':'APPLIED','save':save(),'warnings':[]}
        return 404,{'error':'R5_NOT_FOUND'}


def run():
    cli=argparse.ArgumentParser()
    cli.add_argument('--bind',default='127.0.0.1')
    cli.add_argument('--port',type=int,default=8769)
    args=cli.parse_args()
    cloud=DemoCloud()
    site=Path(__file__).resolve().parent/'site'

    class Handler(SimpleHTTPRequestHandler):
        extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript'}
        def do_POST(self):
            path=urlsplit(self.path).path
            if not path.startswith(BASE):
                self.send_error(404)
                return
            try:
                n=int(self.headers.get('content-length',0))
                if not 0<n<=4096: raise ValueError('length')
                request=json.loads(self.rfile.read(n))
                if not isinstance(request,dict): raise ValueError('object')
                status,body=cloud.call(path[len(BASE):],self.headers,request)
            except (ValueError, TypeError):
                status,body=400,{'error':'BAD_REQUEST'}
            payload=json.dumps(body,ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    if not (site/'index.html').is_file(): cli.error('Build the candidate first.')
    with ThreadingHTTPServer((args.bind,args.port),partial(Handler,directory=str(site))) as server:
        print(f'Coin v1.9 preview: http://{args.bind}:{args.port}/',flush=True)
        server.serve_forever()

if __name__=='__main__':
    run()
