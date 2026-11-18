// Rebuild the self-contained page with Node and esbuild (tested with 0.24.2).
// Usage: node scripts/build-entry.mjs [path-to-esbuild]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const distribution = new URL('../dist/', import.meta.url);
const directory = existsSync(new URL('index.html', distribution)) ? distribution : new URL('../', import.meta.url);
const htmlFile = new URL('index.html', directory);
const esbuild = process.argv[2] || process.env.ESBUILD_BINARY_PATH || 'esbuild';
const result = spawnSync(esbuild, [
  'ui.js', '--bundle', '--format=esm', '--target=es2020',
  // Escape multiline GLSL as strings to keep shader whitespace intact in HTML and Git.
  '--minify', '--charset=utf8', '--legal-comments=eof', '--supported:template-literal=false'
], { cwd: fileURLToPath(directory), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr || 'esbuild failed');

// Keeping the rest of the document editable avoids a separate lobby template.
function generatedBlock(html, name, contents) {
  const open = '<!-- BEGIN generated ' + name + ' -->';
  const close = '<!-- END generated ' + name + ' -->';
  const first = html.indexOf(open);
  const last = html.indexOf(close);
  if (first < 0 || last < first || html.lastIndexOf(open) !== first || html.lastIndexOf(close) !== last) {
    throw new Error('Missing or duplicate ' + name + ' boundaries in index.html');
  }
  return html.slice(0, first + open.length) + '\n' + contents + '\n' + html.slice(last);
}

const css = readFileSync(new URL('style.css', directory), 'utf8').trimEnd();
const js = result.stdout.trimEnd();
if (/<\/script[\s/>]/i.test(js) || /<\/style[\s/>]/i.test(css)) {
  throw new Error('Unescaped HTML end tag in inline assets');
}
let html = readFileSync(htmlFile, 'utf8').replace(/\r\n/g, '\n');
html = generatedBlock(html, 'styles', '<style>\n' + css.replace(/\r\n/g, '\n') + '\n</style>');
html = generatedBlock(html, 'runtime', '<script type="module">\n' + js.replace(/\r\n/g, '\n') + '\n</script>');
writeFileSync(htmlFile, html);
console.log('Playable entry: ' + Buffer.byteLength(html) + ' bytes, ' + gzipSync(html).length + ' gzip');
