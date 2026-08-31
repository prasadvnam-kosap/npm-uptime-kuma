/**
 * Node LOADED tracer.
 *
 *   NODE_OPTIONS="--require ./usage/capture/node-trace.cjs" DEPPROOF_TRACE_DIR=traces npm test
 *
 * READ THIS BEFORE TRUSTING ANY NUMBER IT PRODUCES.
 *
 * This hook is honest for ONE of the three npm cells and unproven for the other two, which is
 * why trace-set.yaml marks them `trace_method: UNPROVEN` and puts uptime-kuma first.
 *
 *   uptime-kuma  `node --test`  -- Node's own runner. Ordinary CommonJS/ESM resolution, no
 *                                 bundler, no transform. This hook sees what it claims to.
 *   axios        `vitest run`   -- vitest resolves through VITE's module graph. A require hook
 *   outline      `vitest run`      observes Node's loader, not necessarily every dependency
 *                                 Vite transformed or inlined. It may UNDER-count loading,
 *                                 which over-reports "never loaded" -- the unsafe direction.
 *
 * The browser projects (axios `browser-headless`, outline `shared-jsdom`, both repos' Playwright
 * suites) execute in a browser or a DOM shim. NODE_OPTIONS cannot observe them at all. They are
 * listed in `excluded_suites` and excluded deliberately rather than silently missed -- a suite
 * you cannot see is not a suite that loaded nothing.
 *
 * The npm row is therefore not one method. Proving it is P6, and it is prerequisite work, not
 * something to discover halfway through a matrix.
 *
 * Emits one file per pid: vitest and jest fork worker processes, same lesson as JVM `%p`.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const dir = process.env.DEPPROOF_TRACE_DIR;
if (dir) {
  const loaded = new Set();

  // Wrap the resolver rather than the loader: _resolveFilename sees every specifier that is
  // actually resolved to a file, including ones a later cache hit would hide.
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    const resolved = origResolve.call(this, request, parent, isMain, options);
    if (typeof resolved === 'string' && resolved.includes('node_modules')) loaded.add(resolved);
    return resolved;
  };

  // ESM does not go through Module._resolveFilename. Anything imported rather than required is
  // invisible here, and both vitest repos are ESM-first. Recorded in the output so the gap
  // travels with the data instead of being rediscovered later.
  const esmCaveat = '# ESM imports are NOT captured by this hook (CJS resolver only)';

  const flush = () => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, `node-${process.pid}.log`);
      fs.writeFileSync(
        out,
        `# pid ${process.pid} argv=${process.argv.slice(1, 3).join(' ')}\n` +
          esmCaveat + '\n' +
          Array.from(loaded).sort().join('\n') + '\n'
      );
    } catch (e) {
      process.stderr.write(`[depproof-trace] shim failed: ${e.message}\n`);
    }
  };

  process.on('exit', flush);
  // Test runners frequently exit via signal; without these the worker traces are simply absent,
  // and absent traces read as "nothing loaded".
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { flush(); process.exit(0); });
  }
}
