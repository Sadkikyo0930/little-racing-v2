import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../docs/explore-preview.html',import.meta.url),'utf8');
const m=html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert(m,'must have module game script');
const code=m[1].replace(/^import \* as THREE from .*?;$/m,'');
new vm.SourceTextModule(code);
for(const text of ['小镇商店','湖边码头','山顶观景点','返回车库','data-key="left"','data-key="right"','data-key="gas"','data-key="brake"','Math.min(devicePixelRatio','requestAnimationFrame(animate)']){
 assert(html.includes(text),'missing '+text);
}
assert(!/localStorage|r5_racing_saves|owned\.frag_|coin_delta|birth(day)?-star/i.test(code),'isolated explore preview cannot write any production save');
assert(!/<script src=.*r5/i.test(html),'no R5 bridge in independent prototype');
console.log('PASS 13/13 whitebox route, touch driving, JS syntax, and no formal save access');
