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
  let buttons = 0;
  const canvas = new Proxy({
    roundRect(){ buttons++; },
    measureText(text){ return {width:text.length * 5}; },
  }, {get:(context,key)=>context[key] ?? (()=>{})});
  drawBuilder(canvas,state);
  return buttons;
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
