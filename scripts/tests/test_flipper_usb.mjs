import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FlipperUpdater} from '../../website/update/flipper.js';

function usbPort(reply) {
  const encoder = new TextEncoder();
  const port = {
    sessions:0, closes:0, signals:[], commands:[],
    async open() {
      this.sessions++;
      this.readable = new ReadableStream({start:controller=>{this.input=controller;}});
      this.writable = new WritableStream({write:bytes=>{
        const cmd = new TextDecoder().decode(bytes);
        this.commands.push(cmd);
        for (const part of reply(cmd,this.sessions)) this.input.enqueue(encoder.encode(part));
      }});
    },
    async close() { this.closes++; },
    async setSignals({dataTerminalReady}) { this.signals.push(dataTerminalReady); },
  };
  return port;
}

const info = ['device_info\r\n','hardware_model : Flipper Zero\r\nhardware_target : 7\r\n','>: '];
const card = ['storage stat "/ext"\r\nStorage, 32000KiB total, 15000KiB free\r\n>: '];

test('identifies a silent session and ignores a late welcome prompt',async()=>{
  for (const banner of [[], ['Eddy Firmware\r\n>: ']]) {
    const port=usbPort(cmd=>cmd==='device_info\r'?[...banner,...info]:card);
    const updater=new FlipperUpdater(port);
    await updater.open();
    assert.deepEqual(port.commands,['device_info\r','storage stat "/ext"\r']);
    await updater.close();
    assert.equal(port.closes,1);
  }
});

test('reopens an unresponsive session and releases the port after two failed probes',async()=>{
  for (const recover of [true,false]) {
    const port=usbPort((cmd,attempt)=>recover && attempt===2?(cmd==='device_info\r'?info:card):[]);
    const updater=new FlipperUpdater(port);
    const until=updater.until.bind(updater);
    updater.until=marker=>until(marker,50);
    if (recover) await updater.open();
    else await assert.rejects(updater.open(),/USB port opened/);
    await updater.close();
    assert.equal(port.sessions,2);
    assert.equal(port.closes,2);
    assert.deepEqual(port.signals,[true,false,true]);
  }
});
