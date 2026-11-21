// USB CDC protocol used by scripts/selfupdate.py and scripts/flipper/storage.py.
const encoder = new TextEncoder();
const prompt = '>: ';
const endLine = '\r\n';

export class FlipperUpdater {
  constructor(port) {
    this.port = port;
    this.pending = '';
  }

  async open() {
    try {
      await this.port.open({baudRate:115200,bufferSize:16384});
    } catch (error) {
      if (error.name !== 'NetworkError' && error.name !== 'InvalidStateError') throw error;
      throw Error('Could not open the Flipper USB port. Quit qFlipper, close other Flipper tabs, then click Connect Flipper Zero again.');
    }
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    await this.port.setSignals({dataTerminalReady:true});
    await this.until(prompt);
    const info = await this.command('device_info');
    if (!/^hardware_target\s*:\s*7\s*$/m.test(info) || !/^hardware_model\s*:/m.test(info)) {
      throw Error('This device did not identify itself as a Flipper Zero F7.');
    }
    const sd = await this.command('storage stat "/ext"');
    if (!/KiB free/i.test(sd)) throw Error('Insert a working microSD card and reconnect.');
  }

  async until(marker) {
    const decoder = new TextDecoder();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('The Flipper stopped responding. Reconnect it and try again.')),20000);
    });
    try {
      while (!this.pending.includes(marker)) {
        const {value,done} = await Promise.race([this.reader.read(),timeout]);
        if (done) throw Error('USB connection closed.');
        this.pending += decoder.decode(value);
        if (this.pending.length > 65536) throw Error('Unexpected USB response.');
      }
      const end = this.pending.indexOf(marker);
      const result = this.pending.slice(0,end);
      this.pending = this.pending.slice(end+marker.length);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async send(command) {
    await this.writer.write(encoder.encode(command+'\r'));
    await this.until(endLine); // The CLI echoes the command before its response.
  }

  async command(command) {
    await this.send(command);
    return (await this.until(prompt)).trim();
  }

  async mkdir(path) {
    const reply = await this.command('storage mkdir "'+path+'"');
    if (reply && !reply.includes('file/dir already exist')) throw Error('Could not create the update directory. '+reply);
  }

  async upload(path, bytes, md5, progress) {
    const stat = await this.command('storage stat "'+path+'"');
    if (/^File, size:/.test(stat)) {
      if ((await this.command('storage md5 "'+path+'"')).toLowerCase() === md5) {
        progress(bytes.length);
        return;
      }
      // write_chunk appends. Replace only this build's incomplete regular file.
      const reply = await this.command('storage remove "'+path+'"');
      if (reply) throw Error('Could not replace the incomplete update file. '+reply);
    } else if (!stat.includes('file/dir not exist')) {
      throw Error('Cannot write the update file. '+stat);
    }
    for (let start=0; start<bytes.length; start+=8192) {
      const chunk = bytes.subarray(start,start+8192);
      await this.send('storage write_chunk "'+path+'" '+chunk.length);
      const ready = await this.until(endLine);
      if (ready.trim() !== 'Ready') throw Error('The microSD card refused the transfer. '+ready);
      await this.writer.write(chunk);
      const reply = (await this.until(prompt)).trim();
      if (reply) throw Error('Transfer failed. '+reply);
      progress(start+chunk.length);
    }
    if ((await this.command('storage md5 "'+path+'"')).toLowerCase() !== md5) {
      throw Error('The copy on the microSD card failed verification. Reconnect to retry.');
    }
  }

  async install(folder) {
    await this.send('update install '+folder+'/update.fuf');
    const verify = await this.until(endLine);
    if (!verify.startsWith('Verifying')) throw Error('Return to the Flipper home screen and retry. '+verify);
    const result = await this.until(endLine);
    if (!/^OK\b/.test(result)) throw Error('The Flipper declined the update. '+result);
  }

  async close() {
    if (this.reader) {
      await this.reader.cancel().catch(()=>{});
      this.reader.releaseLock();
    }
    this.writer?.releaseLock();
    if (this.reader || this.writer) await this.port.close().catch(()=>{});
  }
}
