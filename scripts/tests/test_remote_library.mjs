import assert from 'node:assert/strict';
import {test} from 'node:test';

// A v1 preview can have five holes before its first usable button.
const stored = new Map([['eddy-preview-remotes', JSON.stringify({
  layouts:[{name:'Lamp', cells:[null,null,null,null,null,{name:'Light',icon:0}]}],
  remotes:[{name:'Lamp', buttons:['Power']}],
})]]);
globalThis.localStorage = {
  getItem:key=>stored.get(key),
  setItem:(key,value)=>stored.set(key,value),
};
const form = {}, input = {setCustomValidity(){}, select(){}};
const dialog = {showModal(){}, close(){}, querySelector:key=>({form,input}[key] ?? {})};
globalThis.document = {querySelector:()=>dialog};
const {openBuilder, builderKey, builderStatus, drawBuilder} = await import('../../website/builder-preview.js');
const {layoutDemo, remoteDemo} = await import('../../website/remote-preview.js');
const press = (state,key)=>builderKey(state,key,()=>{});
function renderedButtons(state) {
  const pixels=Array.from({length:64},()=>new Uint8Array(128));
  const canvas = new Proxy({
    fillRect(x,y,w,h){
      for(let i=y;i<y+h;i++) if(pixels[i]) pixels[i].fill(1,Math.max(0,x),Math.min(x+w,128));
    },
  }, {get:(context,key)=>context[key] ?? (()=>{})});
  drawBuilder(canvas,state);
  return [12,29].reduce((count,y)=>count+
    pixels[y].reduce((runs,pixel,x)=>runs+Number(Boolean(pixel && !pixels[y][x-1])),0),0);
}

test('a sparse custom layout and a learned IR remote with the same name stay distinct', () => {
  const custom = openBuilder('Lamp');
  const learned = openBuilder('Lamp','remote');
  assert.match(builderStatus(custom),/Light/);
  assert.match(builderStatus(learned),/Power/);
  assert.equal(renderedButtons(custom),2); // One saved button and one add control.
  assert.equal(layoutDemo.create('Desk'), '');
  assert.equal(renderedButtons(openBuilder('Desk')),1);
});

test('a ten-button TV preset opens a second page and can be deleted or kept', () => {
  const remote = openBuilder();
  press(remote,'down'); press(remote,'ok'); // TV presets
  for(let i=0;i<3;i++) press(remote,'down');
  press(remote,'ok'); // TCL Roku, including its five navigation buttons
  for(let i=0;i<7;i++) press(remote,'right');
  assert.equal(renderedButtons(remote),5); // Four controls plus Add button.
  assert.match(builderStatus(remote),/^OK\./);
  press(remote,'ok');
  assert.match(builderStatus(remote),/Demo sent/);
  remoteDemo.select(remote.name);
  assert.equal(remoteDemo.buttons.length,10);
  const name = remote.name;
  press(remote,'hold'); press(remote,'up'); press(remote,'ok'); press(remote,'left');
  assert.ok(layoutDemo.get(name,'remote'));
  press(remote,'up'); press(remote,'ok'); press(remote,'ok');
  assert.equal(remote.step,'library');
  assert.equal(layoutDemo.get(name,'remote'),undefined);
});

test('failed Infrared preview writes preserve the remote, its buttons and its shortcut', () => {
  assert.equal(remoteDemo.edit('create','Desk lamp','Power'),'');
  assert.ok(remoteDemo.setPinned(true));
  const before=stored.get('eddy-preview-remotes');
  const previous=localStorage.setItem;
  localStorage.setItem=()=>{ throw new Error('Storage full'); };
  try {
    assert.match(remoteDemo.edit('add','','Dim'),/Could not save/);
    assert.match(remoteDemo.edit('rename','Reading lamp',''),/Could not save/);
    assert.match(remoteDemo.edit('create','New lamp','Power'),/Could not save/);
    assert.equal(remoteDemo.remove(),false);
    assert.equal(remoteDemo.active,'Desk lamp');
    assert.deepEqual(remoteDemo.buttons,['Power']);
    assert.ok(remoteDemo.pins.includes('Desk lamp'));
    assert.equal(layoutDemo.get('Reading lamp','remote'),undefined);
    assert.equal(layoutDemo.get('New lamp','remote'),undefined);
    assert.equal(stored.get('eddy-preview-remotes'),before);
  } finally {
    localStorage.setItem=previous;
  }
  assert.ok(remoteDemo.remove());
  assert.equal(layoutDemo.get('Desk lamp','remote'),undefined);
  assert.ok(!remoteDemo.pins.includes('Desk lamp'));
});

test('the library delete action cancels or removes just the selected remote and its pin', () => {
  const savedName = layoutDemo.addPreset('Review TV',['Power']);
  for (const [name,kind] of [['Lamp','layout'],['Lamp','remote'],[savedName,'remote']]) {
    assert.equal(layoutDemo.setPinned(name,true,kind),'');
  }
  function select(state, label) {
    for(let i=0;i<32 && builderStatus(state)!==label;i++) press(state,'down');
    assert.equal(builderStatus(state),label);
    press(state,'ok');
  }
  for (const [name,kind] of [['Lamp','remote'],[savedName,'remote'],['Lamp','layout']]) {
    const state = openBuilder();
    select(state,'Delete a remote');
    const label = name+' ('+layoutDemo.source(name,kind)+')';
    select(state,label);
    assert.equal(state.step,'delete');
    press(state,'back');
    assert.equal(builderStatus(state),label);
    assert.ok(layoutDemo.pinned(name,kind));
    press(state,'ok'); press(state,'left');
    assert.equal(builderStatus(state),label);
    press(state,'ok'); press(state,'ok');
    assert.equal(state.step,'library');
    assert.equal(layoutDemo.get(name,kind),undefined);
    assert.equal(layoutDemo.pinned(name,kind),false);
    if (kind==='remote') assert.ok(layoutDemo.get('Lamp','layout'));
  }
});
