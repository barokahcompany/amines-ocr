// pyworker.cjs
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

class PyWorker {
  constructor(scriptPath) {
    this.proc = spawn('python3.10', ['-u', scriptPath], { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    this.buf = '';
    this.pending = new Map();
    this.seq = 0;

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      this.buf += chunk;
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          msg.status ? p.resolve(msg) : p.reject(msg);
        }
      }
    });

    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (e) => console.error('[PY STDERR]', e));

    this.proc.on('exit', (code) => {
      console.error('Python worker exited:', code);
      for (const [,p] of this.pending) p.reject(new Error('Worker died'));
      this.pending.clear();
    });
  }

  call(payload, timeoutMs = 25000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('OCR timeout'));
        }
      }, timeoutMs);
      const data = JSON.stringify({ id, ...payload }) + '\n';
      this.proc.stdin.write(data, 'utf8', () => clearTimeout(timer));
    });
  }
}

function initWorkers(scriptPath, size) {
  const n = Math.max(1, Math.min(size || 2, Math.max(1, os.cpus().length - 1)));
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(new PyWorker(scriptPath));
  let rr = 0;
  const call = (payload, timeoutMs) => {
    rr = (rr + 1) % arr.length;
    return arr[rr].call(payload, timeoutMs);
  };
  return { workers: arr, call };
}

module.exports = { PyWorker, initWorkers };
