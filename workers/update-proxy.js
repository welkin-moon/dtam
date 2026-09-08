const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Cache-Control',
  'Access-Control-Expose-Headers': 'Content-Length, ETag, X-DTAM-SHA256, X-DTAM-Version',
};

function json(value, status = 200, extra = {}) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=30, s-maxage=30' : 'no-store',
      ...CORS,
      ...extra,
    },
  });
}

async function loadManifest(env) {
  const data = await env.DTAM_UPDATES.get('latest.json', 'json');
  if (!data || data.schema !== 1 || !/^\d+\.\d+\.\d+$/.test(String(data.version || ''))) throw new Error('latest.json missing or invalid');
  for (const kind of ['windows', 'android']) {
    const item = data[kind];
    const chunks = Array.isArray(item?.chunks) ? item.chunks : [];
    const total = chunks.reduce((sum, chunk) => sum + Number(chunk?.size || 0), 0);
    if (!item || item.version !== data.version || !/^[0-9a-f]{64}$/i.test(String(item.sha256 || '')) || !(Number(item.size) > 0) || !chunks.length || total !== Number(item.size)) {
      throw new Error(`invalid ${kind} manifest entry`);
    }
    if (chunks.some(chunk => !String(chunk?.key || '').startsWith(`releases/${data.version}/${kind}/`) || !(Number(chunk?.size) > 0) || !/^[0-9a-f]{64}$/i.test(String(chunk?.sha256 || '')))) {
      throw new Error(`invalid ${kind} chunk list`);
    }
  }
  return data;
}

function publicManifest(data, origin) {
  const expose = kind => {
    const item = data[kind];
    return {
      version: item.version,
      ...(kind === 'android' ? { versionCode: Number(item.versionCode || 0) } : {}),
      url: `${origin}/${kind}?v=${encodeURIComponent(item.version)}`,
      sha256: String(item.sha256).toLowerCase(),
      size: Number(item.size),
      chunks: item.chunks.map((chunk, index) => ({
        url: `${origin}/${kind}/chunk/${index}?v=${encodeURIComponent(item.version)}`,
        sha256: String(chunk.sha256).toLowerCase(),
        size: Number(chunk.size),
      })),
    };
  };
  return {
    schema: 1,
    version: data.version,
    publishedAt: data.publishedAt || null,
    windows: expose('windows'),
    android: expose('android'),
  };
}

function assetHeaders(item, kind, size = item.size, sha256 = item.sha256, filename = item.filename) {
  const headers = new Headers(CORS);
  headers.set('Content-Type', kind === 'android' ? 'application/vnd.android.package-archive' : 'application/vnd.microsoft.portable-executable');
  headers.set('Content-Disposition', `attachment; filename="${String(filename || `DTAM-${kind}`).replace(/["\\\r\n]/g, '_')}"`);
  headers.set('Content-Length', String(size));
  headers.set('ETag', `"${String(sha256).slice(0, 32)}"`);
  headers.set('X-DTAM-SHA256', String(sha256).toLowerCase());
  headers.set('X-DTAM-Version', item.version);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  return headers;
}

async function chunkResponse(request, env, kind, index) {
  const data = await loadManifest(env);
  const item = data[kind];
  const wanted = new URL(request.url).searchParams.get('v');
  if (wanted && wanted !== item.version) return json({ error: 'release_changed', latest: item.version }, 409);
  const chunk = item.chunks[index];
  if (!chunk) return json({ error: 'chunk_not_found' }, 404);
  const headers = assetHeaders(item, kind, chunk.size, chunk.sha256, `${item.filename}.part-${String(index).padStart(3, '0')}`);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const bytes = await env.DTAM_UPDATES.get(chunk.key, 'arrayBuffer');
  if (!bytes || bytes.byteLength !== Number(chunk.size)) return json({ error: 'chunk_unavailable' }, 503);
  return new Response(bytes, { status: 200, headers });
}

async function assetResponse(request, env, kind) {
  const data = await loadManifest(env);
  const item = data[kind];
  const wanted = new URL(request.url).searchParams.get('v');
  if (wanted && wanted !== item.version) return json({ error: 'release_changed', latest: item.version }, 409);
  const headers = assetHeaders(item, kind);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });

  let index = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (index >= item.chunks.length) {
        controller.close();
        return;
      }
      const chunk = item.chunks[index++];
      const bytes = await env.DTAM_UPDATES.get(chunk.key, 'arrayBuffer');
      if (!bytes || bytes.byteLength !== Number(chunk.size)) {
        controller.error(new Error(`update chunk unavailable: ${chunk.key}`));
        return;
      }
      controller.enqueue(new Uint8Array(bytes));
    },
  });
  return new Response(stream, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, OPTIONS' });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') return json({ ok: true, source: 'cloudflare-kv-chunks' });
      if (url.pathname === '/' || url.pathname === '/latest.json') {
        const data = await loadManifest(env);
        if (request.method === 'HEAD') return new Response(null, { status: 200, headers: { ...CORS, 'Cache-Control': 'no-store' } });
        return json(publicManifest(data, url.origin));
      }
      const chunkMatch = url.pathname.match(/^\/(windows|android)\/chunk\/(\d+)$/);
      if (chunkMatch) return await chunkResponse(request, env, chunkMatch[1], Number(chunkMatch[2]));
      if (url.pathname === '/windows') return await assetResponse(request, env, 'windows');
      if (url.pathname === '/android') return await assetResponse(request, env, 'android');
      return json({ error: 'not_found' }, 404);
    } catch (error) {
      return json({ error: 'updater_unavailable', message: String(error?.message || error).slice(0, 200) }, 503);
    }
  },
};
