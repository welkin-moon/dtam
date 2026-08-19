const ROOM_TTL_MS = 4 * 60 * 60 * 1000;
const PEER_TTL_MS = 2 * 60 * 1000;
const MAX_BODY = 64 * 1024;
const ROOM_RE = /^\d{2}$/;
const PEER_RE = /^[a-f0-9]{16,64}$/i;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Cache-Control': 'no-store',
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
});

const bad = (message, status = 400, code = 'bad_request') => json({ ok: false, code, message }, status);
const now = () => Date.now();
const token = () => crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new Error('payload_too_large');
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('payload_too_large');
  return text ? JSON.parse(text) : {};
}

async function cleanupMaybe(db) {
  const b = new Uint8Array(1);
  crypto.getRandomValues(b);
  if ((b[0] & 63) !== 0) return;
  const t = now();
  try {
    await db.batch([
      db.prepare('DELETE FROM peers WHERE expires_at <= ?').bind(t),
      db.prepare('DELETE FROM rooms WHERE expires_at <= ?').bind(t),
    ]);
  } catch (_) {}
}

async function activeRoom(db, room) {
  return db.prepare('SELECT room, host_id, host_token, state, expires_at FROM rooms WHERE room = ? AND expires_at > ?')
    .bind(room, now()).first();
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'dtam-p2p-signal', storage: 'd1', mode: 'mailbox', version: '1' });
    if (!env.SIGNAL_DB) return bad('D1 binding missing', 503, 'storage_unavailable');

    await cleanupMaybe(env.SIGNAL_DB);

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'v1' || parts[1] !== 'rooms' || !ROOM_RE.test(parts[2] || '')) return bad('not found', 404, 'not_found');
    const room = parts[2];
    const action = parts[3] || '';

    try {
      if (request.method === 'POST' && action === 'claim') {
        const body = await readJson(request);
        const hostId = String(body.hostId || '').toLowerCase();
        const hostToken = String(body.hostToken || '');
        if (!PEER_RE.test(hostId) || hostToken.length < 32) return bad('invalid host identity');
        const t = now(), expires = t + ROOM_TTL_MS;
        const row = await env.SIGNAL_DB.prepare(`
          INSERT INTO rooms(room, host_id, host_token, state, created_at, updated_at, expires_at)
          VALUES(?, ?, ?, 'lobby', ?, ?, ?)
          ON CONFLICT(room) DO UPDATE SET
            host_id = excluded.host_id,
            host_token = excluded.host_token,
            state = 'lobby',
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
          WHERE rooms.expires_at <= excluded.updated_at
             OR (rooms.host_id = excluded.host_id AND rooms.host_token = excluded.host_token)
          RETURNING room, state, expires_at
        `).bind(room, hostId, hostToken, t, t, expires).first();
        if (!row) return bad('room exists', 409, 'room_exists');
        return json({ ok: true, room, state: row.state, expiresAt: Number(row.expires_at) }, 201);
      }

      if (request.method === 'POST' && action === 'state') {
        const body = await readJson(request);
        const hostToken = String(body.hostToken || '');
        const state = String(body.state || '');
        if (!['lobby', 'started'].includes(state)) return bad('invalid room state');
        const r = await env.SIGNAL_DB.prepare('UPDATE rooms SET state = ?, updated_at = ? WHERE room = ? AND host_token = ? AND expires_at > ?')
          .bind(state, now(), room, hostToken, now()).run();
        if (!r.meta?.changes) return bad('room not found', 404, 'room_not_found');
        return json({ ok: true, state });
      }

      if (request.method === 'DELETE' && !action) {
        const hostToken = String(url.searchParams.get('hostToken') || '');
        await env.SIGNAL_DB.batch([
          env.SIGNAL_DB.prepare('DELETE FROM peers WHERE room = ?').bind(room),
          env.SIGNAL_DB.prepare('DELETE FROM rooms WHERE room = ? AND host_token = ?').bind(room, hostToken),
        ]);
        return json({ ok: true });
      }

      if (request.method === 'POST' && action === 'join') {
        const body = await readJson(request);
        const peerId = String(body.peerId || '').toLowerCase();
        if (!PEER_RE.test(peerId)) return bad('invalid peer id');
        const r = await activeRoom(env.SIGNAL_DB, room);
        if (!r) return bad('room not found', 404, 'room_not_found');
        if (r.state !== 'lobby') return bad('game already started', 409, 'game_in_progress');
        const joinToken = token(), t = now(), expires = t + PEER_TTL_MS;
        await env.SIGNAL_DB.prepare(`
          INSERT INTO peers(room, peer_id, join_token, offer, answer, created_at, updated_at, expires_at)
          VALUES(?, ?, ?, NULL, NULL, ?, ?, ?)
          ON CONFLICT(room, peer_id) DO UPDATE SET
            join_token = excluded.join_token,
            offer = NULL,
            answer = NULL,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at
        `).bind(room, peerId, joinToken, t, t, expires).run();
        return json({ ok: true, room, peerId, joinToken, expiresAt: expires }, 202);
      }

      if (request.method === 'GET' && action === 'joins') {
        const hostToken = String(url.searchParams.get('hostToken') || '');
        const r = await activeRoom(env.SIGNAL_DB, room);
        if (!r || r.host_token !== hostToken) return bad('forbidden', 403, 'forbidden');
        const rows = await env.SIGNAL_DB.prepare('SELECT peer_id, created_at FROM peers WHERE room = ? AND offer IS NULL AND expires_at > ? ORDER BY created_at ASC LIMIT 32')
          .bind(room, now()).all();
        return json({ ok: true, peers: (rows.results || []).map(x => ({ peerId: x.peer_id, createdAt: Number(x.created_at) })) });
      }

      if (action === 'offers' && PEER_RE.test(parts[4] || '')) {
        const peerId = parts[4].toLowerCase();
        if (request.method === 'POST') {
          const body = await readJson(request), hostToken = String(body.hostToken || ''), offer = body.offer;
          if (!offer || typeof offer.sdp !== 'string' || offer.sdp.length > 48000) return bad('invalid offer');
          const r = await activeRoom(env.SIGNAL_DB, room);
          if (!r || r.host_token !== hostToken || r.state !== 'lobby') return bad('forbidden', 403, 'forbidden');
          const q = await env.SIGNAL_DB.prepare('UPDATE peers SET offer = ?, updated_at = ?, expires_at = ? WHERE room = ? AND peer_id = ? AND expires_at > ?')
            .bind(JSON.stringify(offer), now(), now() + PEER_TTL_MS, room, peerId, now()).run();
          if (!q.meta?.changes) return bad('peer not found', 404, 'peer_not_found');
          return json({ ok: true });
        }
        if (request.method === 'GET') {
          const joinToken = String(url.searchParams.get('joinToken') || '');
          const row = await env.SIGNAL_DB.prepare('SELECT offer FROM peers WHERE room = ? AND peer_id = ? AND join_token = ? AND expires_at > ?')
            .bind(room, peerId, joinToken, now()).first();
          if (!row) return bad('peer not found', 404, 'peer_not_found');
          return row.offer ? json({ ok: true, ready: true, offer: JSON.parse(row.offer) }) : json({ ok: true, ready: false }, 202);
        }
      }

      if (action === 'answers' && PEER_RE.test(parts[4] || '')) {
        const peerId = parts[4].toLowerCase();
        if (request.method === 'POST') {
          const body = await readJson(request), joinToken = String(body.joinToken || ''), answer = body.answer;
          if (!answer || typeof answer.sdp !== 'string' || answer.sdp.length > 48000) return bad('invalid answer');
          const q = await env.SIGNAL_DB.prepare('UPDATE peers SET answer = ?, updated_at = ?, expires_at = ? WHERE room = ? AND peer_id = ? AND join_token = ? AND expires_at > ?')
            .bind(JSON.stringify(answer), now(), now() + PEER_TTL_MS, room, peerId, joinToken, now()).run();
          if (!q.meta?.changes) return bad('peer not found', 404, 'peer_not_found');
          return json({ ok: true });
        }
        if (request.method === 'GET') {
          const hostToken = String(url.searchParams.get('hostToken') || '');
          const r = await activeRoom(env.SIGNAL_DB, room);
          if (!r || r.host_token !== hostToken) return bad('forbidden', 403, 'forbidden');
          const row = await env.SIGNAL_DB.prepare('SELECT answer FROM peers WHERE room = ? AND peer_id = ? AND expires_at > ?')
            .bind(room, peerId, now()).first();
          if (!row) return bad('peer not found', 404, 'peer_not_found');
          return row.answer ? json({ ok: true, ready: true, answer: JSON.parse(row.answer) }) : json({ ok: true, ready: false }, 202);
        }
      }

      return bad('not found', 404, 'not_found');
    } catch (error) {
      if (String(error?.message || error) === 'payload_too_large') return bad('payload too large', 413, 'payload_too_large');
      console.error('dtam-p2p-signal', error);
      return bad('internal error', 500, 'internal_error');
    }
  },
};
