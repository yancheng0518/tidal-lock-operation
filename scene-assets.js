import { packs } from './scene-assets/manifest.js';

const totalFiles = packs.reduce((sum, pack) => sum + pack.entries.length, 0);
const rawSize = entries => entries.reduce((sum, [, size]) => sum + size, 0);
const root = path => new URL(path, document.baseURI).href;
const mime = path => path.endsWith('.glb') ? 'model/gltf-binary' :
  path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

async function readAsset(url, size, sha256, onChunk, signal, cache) {
  const response = await fetch(url, { signal, cache });
  if (!response.ok) throw new Error('资源请求失败（HTTP ' + response.status + '）');
  let bytes;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    bytes = new Uint8Array(size);
    let offset = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (offset + value.length > size) throw new Error('资源长度超出预期');
        bytes.set(value, offset);
        offset += value.length;
        onChunk(value.length);
      }
      if (offset !== size) throw new Error('资源传输中断');
    } catch (error) {
      reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== size) throw new Error('资源传输中断');
    onChunk(bytes.length);
  }
  if (globalThis.crypto?.subtle) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== sha256) throw new Error('资源校验失败');
  }
  return bytes;
}

export async function loadSceneAssets(onProgress, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once:true });
  const urls = new Map();
  const dispose = () => {
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
  };
  const canInflate = typeof DecompressionStream === 'function' && typeof Blob.prototype.stream === 'function';
  const states = packs.map(pack => ({
    received:0, expected:!canInflate && pack.compressed ? rawSize(pack.entries) : pack.size,
    complete:0
  }));
  let previousReport = -Infinity;
  function report(force=false) {
    if (!onProgress || controller.signal.aborted) return;
    const now = performance.now();
    if (!force && now - previousReport < 65) return;
    previousReport = now;
    onProgress({
      loaded: states.reduce((sum,s) => sum+s.complete, 0), total:totalFiles,
      loadedBytes:states.reduce((sum,s) => sum+s.received, 0),
      totalBytes:states.reduce((sum,s) => sum+s.expected, 0)
    });
  }
  function register(path, blob) {
    if (controller.signal.aborted) throw new DOMException('Aborted','AbortError');
    urls.set(path, URL.createObjectURL(blob));
  }
  async function loadGroup(pack, index) {
    const state = states[index];
    const chunk = size => { state.received+=size; report(); };
    if (canInflate || !pack.compressed) {
      try {
        const bytes=await readAsset(root('scene-assets/'+pack.file),pack.size,pack.sha256,chunk,controller.signal,'force-cache');
        let archive=new Blob([bytes]);
        if (pack.compressed) {
          const decoded=archive.stream().pipeThrough(new DecompressionStream('gzip'));
          archive=await new Response(decoded).blob();
        }
        if (archive.size !== rawSize(pack.entries)) throw new Error('资源包内容不完整');
        let offset=0;
        for (const [path,length] of pack.entries) {
          register(path,archive.slice(offset,offset+length,mime(path)));
          offset+=length;
        }
        state.complete=pack.entries.length;report(true);
        return;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        // Old proxies and embedded engines may reject binary packs. Retry only
        // this group and remove the discarded bytes from the visible progress.
        state.received=0;state.expected=rawSize(pack.entries);
        report(true);
      }
    }
    await Promise.all(pack.entries.map(async ([path,length,sha]) => {
      const bytes=await readAsset(root(path),length,sha,chunk,controller.signal,'default');
      register(path,new Blob([bytes],{type:mime(path)}));
      state.complete++;report(true);
    }));
  }
  try {
    report(true);
    await Promise.all(packs.map(loadGroup));
    if (controller.signal.aborted) throw new DOMException('Aborted','AbortError');
    return {
      url(path) {
        const url=urls.get(path);
        if (!url) throw new Error('未载入资源：'+path);
        return url;
      },
      dispose
    };
  } catch (error) {
    abort();dispose();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
