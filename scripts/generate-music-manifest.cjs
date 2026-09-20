const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MUSIC_DIR = path.join(ROOT, 'assets', 'music');
const MANIFEST = path.join(MUSIC_DIR, 'manifest.json');
const AUDIO_EXTS = ['.m4a', '.mp3', '.mov', '.mp4', '.webm', '.ogg'];
const COVER_EXTS = ['.png', '.webp', '.jpg', '.jpeg'];

function safeBase(name) {
  return !!name &&
    name.length <= 80 &&
    !name.includes('..') &&
    !/[\\/\u0000-\u001f\u007f]/.test(name);
}

function assetUrl(file) {
  return '/assets/music/' + encodeURIComponent(file);
}

const files = fs.readdirSync(MUSIC_DIR, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name);

const byBase = new Map();
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  if (!AUDIO_EXTS.includes(ext) && !COVER_EXTS.includes(ext)) continue;
  const base = file.slice(0, -ext.length);
  if (!safeBase(base)) {
    console.warn('[music] ignored unsafe filename:', file);
    continue;
  }
  const rec = byBase.get(base) || { name: base, audio: null, cover: null };
  if (AUDIO_EXTS.includes(ext)) {
    const currentRank = rec.audio ? AUDIO_EXTS.indexOf(path.extname(rec.audio).toLowerCase()) : Infinity;
    const nextRank = AUDIO_EXTS.indexOf(ext);
    if (!rec.audio || nextRank < currentRank) rec.audio = file;
  } else if (COVER_EXTS.includes(ext)) {
    const currentRank = rec.cover ? COVER_EXTS.indexOf(path.extname(rec.cover).toLowerCase()) : Infinity;
    const nextRank = COVER_EXTS.indexOf(ext);
    if (!rec.cover || nextRank < currentRank) rec.cover = file;
  }
  byBase.set(base, rec);
}

const tracks = [...byBase.values()]
  .filter(rec => rec.audio)
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  .map(rec => ({
    name: rec.name,
    title: rec.name,
    src: assetUrl(rec.audio),
    cover: rec.cover ? assetUrl(rec.cover) : ''
  }));

const manifest = {
  schema: 2,
  generated: true,
  tracks
};

fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[music] generated manifest with ' + tracks.length + ' track(s): ' + tracks.map(t => t.name).join(', '));
