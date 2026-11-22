import ps from 'prismarine-schematic';
const { Schematic } = ps;
const MAX = 20000;
const isAir = n => n.endsWith('air');

export async function fromSchematic(buf, version) {
  const s = await Schematic.read(buf, version), o = s.start(), blocks = [];
  if (s.size.x * s.size.y * s.size.z > 3000000) throw new Error('That schematic is too large.');
  await s.forEach((b, p) => {
    if (isAir(b.name)) return;
    const pr = Object.entries(b.getProperties()).map(([k, v]) => k + '=' + v).join(',');
    blocks.push({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z, name: b.name, state: pr ? `[${pr}]` : '' });
  });
  if (!blocks.length) throw new Error('That schematic is empty.');
  if (blocks.length > MAX) throw new Error(`Schematic has ${blocks.length} blocks; the limit is ${MAX}.`);
  return blocks;
}

// merge blocks into boxes so /fill needs far fewer commands
export function toBoxes(blocks) {
  const key = (x, y, z) => x + ',' + y + ',' + z, m = new Map(), done = new Set(), out = [];
  for (const b of blocks) m.set(key(b.x, b.y, b.z), b.name + (b.state || ''));
  const same = (x, y, z, t) => m.get(key(x, y, z)) === t && !done.has(key(x, y, z));
  for (const b of [...blocks].sort((a, c) => a.y - c.y || a.z - c.z || a.x - c.x)) {
    if (done.has(key(b.x, b.y, b.z))) continue;
    const t = b.name + (b.state || ''); let x2 = b.x, z2 = b.z, y2 = b.y;
    while (same(x2 + 1, b.y, b.z, t) && x2 - b.x < 31) x2++;
    const row = z => { for (let x = b.x; x <= x2; x++) if (!same(x, b.y, z, t)) return false; return true; };
    while (row(z2 + 1) && z2 - b.z < 31) z2++;
    const layer = y => { for (let z = b.z; z <= z2; z++) for (let x = b.x; x <= x2; x++) if (!same(x, y, z, t)) return false; return true; };
    while (layer(y2 + 1) && y2 - b.y < 31) y2++;
    for (let y = b.y; y <= y2; y++) for (let z = b.z; z <= z2; z++) for (let x = b.x; x <= x2; x++) done.add(key(x, y, z));
    out.push({ x1: b.x, y1: b.y, z1: b.z, x2, y2, z2, name: b.name, state: b.state || '' });
  }
  return out;
}
