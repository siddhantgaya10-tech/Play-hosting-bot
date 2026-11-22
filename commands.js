import pf from 'mineflayer-pathfinder';
import cb from 'mineflayer-collectblock';
import pvp from 'mineflayer-pvp';
import { toBoxes } from './build.js';
const { pathfinder, Movements, goals } = pf;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hostile = e => e && (e.type === 'hostile' || e.kind === 'Hostile mobs');

export function setup(bot, r) {
  bot.physicsEnabled = false;
  bot.loadPlugin(pathfinder); bot.loadPlugin(cb.plugin || cb); bot.loadPlugin(pvp.plugin || pvp);
  bot.once('spawn', () => { bot.pathfinder.setMovements(new Movements(bot)); bot.physicsEnabled = false; });
  let task = 0, eating = false, lastKey = '', lastAt = 0;
  const say = m => { bot.chat(String(m).slice(0, 250)); r.log('bot: ' + m); };
  const ownerName = () => (r.cfg.owner || '').toLowerCase();
  const ownerEnt = () => { const k = Object.keys(bot.players).find(n => n.toLowerCase() === ownerName()); return k && bot.players[k].entity; };
  const stop = () => {
    task++; r.busy = false;
    try { bot.collectBlock.cancelTask(() => {}); } catch {}
    try { bot.pathfinder.setGoal(null); bot.pvp.stop(); bot.clearControlStates(); bot.stopDigging(); } catch {}
    bot.physicsEnabled = false;
  };
  const run = async fn => {
    stop(); const id = task; r.busy = true; bot.physicsEnabled = true;
    try { await fn(() => id !== task); } catch (e) { if (id === task) say('Failed: ' + String(e.message).slice(0, 90)); }
    if (id === task) { r.busy = false; bot.physicsEnabled = false; }
  };
  const ids = names => names.map(n => bot.registry.blocksByName[n]?.id).filter(x => x !== undefined);
  const mineIds = n => { n = n.toLowerCase().replace(/ /g, '_'); return ids([n, n + '_ore', 'deepslate_' + n + '_ore']); };
  const logIds = () => Object.values(bot.registry.blocksByName).filter(b => /_(log|stem)$/.test(b.name) && !b.name.startsWith('stripped')).map(b => b.id);
  const gather = (c, matching, n, label) => async () => {
    let got = 0;
    while (got < n && !c()) {
      const pos = bot.findBlocks({ matching, maxDistance: 48, count: Math.min(n - got, 8) });
      if (!pos.length) { say(`No more ${label} nearby. Got ${got}.`); return; }
      await bot.collectBlock.collect(pos.map(p => bot.blockAt(p))); got += pos.length;
    }
    if (!c()) say(`Done: collected ${got} ${label}.`);
  };
  const V = (x, y, z) => new (bot.entity.position.constructor)(x, y, z);
  const goNear = (p, rad = 2) => bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, rad));
  const find = (n) => bot.inventory.items().find(i => i.name.includes(n.toLowerCase().replace(/ /g, '_')));

  const cmds = {
    craft: a => run(async () => {
      const n = parseInt(a[a.length - 1]) || 1, name = a.filter(x => isNaN(x)).join('_'), item = bot.registry.itemsByName[name];
      if (!item) return say('Unknown item: ' + name);
      let table = null, rec = bot.recipesFor(item.id, null, 1, null);
      if (!rec.length) { table = bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 32 }); if (!table) return say('I need a crafting table nearby or more materials.'); await goNear(table.position); rec = bot.recipesFor(item.id, null, 1, table); }
      if (!rec.length) return say('Missing materials for ' + name);
      await bot.craft(rec[0], n, table); say(`Crafted ${name} x${n}`);
    }),
    place: a => run(async () => {
      const it = find(a[0] || ''); if (!it) return say("I don't have " + a[0]);
      const [x, y, z] = a.slice(1, 4).map(Number); if ([x, y, z].some(isNaN)) return say('Use: !place block x y z');
      const t = V(x, y, z); if (bot.entity.position.distanceTo(t) > 4) await goNear(t, 3);
      await bot.equip(it, 'hand');
      for (const d of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) { const ref = bot.blockAt(t.offset(...d)); if (ref && ref.boundingBox === 'block') { await bot.placeBlock(ref, V(-d[0], -d[1], -d[2])); return; } }
      say('Nothing to place against there.');
    }),
    dig: a => run(async () => { const [x, y, z] = a.map(Number); const b = bot.blockAt(V(x, y, z)); if (!b || b.name === 'air') return say('Nothing there.'); await bot.collectBlock.collect(b); }),
    use: a => run(async () => { const [x, y, z] = a.map(Number); const b = bot.blockAt(V(x, y, z)); if (!b) return say('No block there.'); await goNear(b.position, 3); await bot.activateBlock(b); }),
    fish: a => run(async c => {
      const n = parseInt(a[0]) || 5, rod = find('fishing_rod'); if (!rod) return say('I need a fishing rod.');
      const w = bot.findBlock({ matching: bot.registry.blocksByName.water.id, maxDistance: 24 }); if (!w) return say('No water nearby.');
      await goNear(w.position, 4); await bot.lookAt(w.position.offset(0.5, 0.5, 0.5)); await bot.equip(rod, 'hand');
      for (let i = 0; i < n && !c(); i++) await bot.fish(); say(`Fished ${n} times.`);
    }),
    deposit: a => run(async () => {
      const ch = bot.findBlock({ matching: b => ['chest', 'trapped_chest', 'barrel'].includes(b.name), maxDistance: 32 }); if (!ch) return say('No chest nearby.');
      await goNear(ch.position, 2); const w = await bot.openContainer(ch), want = (a[0] || 'all').toLowerCase();
      for (const it of bot.inventory.items()) if (want === 'all' || it.name.includes(want)) await w.deposit(it.type, null, it.count);
      w.close(); say('Deposited.');
    }),
    take: a => run(async () => {
      const ch = bot.findBlock({ matching: b => ['chest', 'trapped_chest', 'barrel'].includes(b.name), maxDistance: 32 }); if (!ch) return say('No chest nearby.');
      await goNear(ch.position, 2); const w = await bot.openContainer(ch), n = parseInt(a[a.length - 1]), name = a.filter(x => isNaN(x)).join('_');
      const it = w.containerItems().find(i => i.name.includes(name)); if (it) await w.withdraw(it.type, null, isNaN(n) ? it.count : n); w.close(); say(it ? 'Took ' + it.name : 'Not in the chest.');
    }),
    armor: () => run(async () => { for (const [slot, suf] of [['head', 'helmet'], ['torso', 'chestplate'], ['legs', 'leggings'], ['feet', 'boots']]) { const it = bot.inventory.items().filter(i => i.name.endsWith(suf)).pop(); if (it) await bot.equip(it, slot); } say('Armor on.'); }),
    eat: () => run(async () => { const f = bot.inventory.items().find(i => bot.registry.foodsByName[i.name]); if (!f) return say('No food.'); await bot.equip(f, 'hand'); await bot.consume(); }),
    run: a => bot.chat(a.join(' ').slice(0, 250)),
    help: () => say('Just talk to me normally. Commands: !come !follow !stop !goto !mine !chop !collect !attack !guard !give !drop !equip !craft !place !dig !use !fish !deposit !take !armor !eat !sleep !inv !pos !say !run'),
    come: () => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); await bot.pathfinder.goto(new goals.GoalNear(o.position.x, o.position.y, o.position.z, 2)); }),
    follow: () => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); say('Following you.'); bot.pathfinder.setGoal(new goals.GoalFollow(o, 2), true); while (!c()) await sleep(1000); }),
    stop: () => { plan++; stop(); say('Stopped.'); },
    goto: a => run(async c => { const [x, y, z] = a.map(Number); if ([x, y, z].some(isNaN)) return say('Use: !goto x y z'); await bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)); say('Arrived.'); }),
    mine: a => run(async c => { const n = parseInt(a[a.length - 1]) || 1, name = a.filter(x => isNaN(x)).join('_'); const m = mineIds(name); if (!m.length) return say('Unknown block: ' + name); say(`Mining ${n} ${name}`); await gather(c, m, n, name)(); }),
    chop: a => run(async c => { const n = parseInt(a[0]) || 10; say(`Chopping ${n} logs`); await gather(c, logIds(), n, 'logs')(); }),
    collect: () => run(async c => {
      const items = Object.values(bot.entities).filter(e => (e.name === 'item' || e.displayName === 'Item') && bot.entity.position.distanceTo(e.position) < 32);
      for (const e of items) { if (c()) return; await bot.pathfinder.goto(new goals.GoalNear(e.position.x, e.position.y, e.position.z, 0)).catch(() => {}); }
      say(`Picked up ${items.length} drops.`);
    }),
    attack: a => run(async c => {
      const t = a[0] ? Object.values(bot.players).find(p => p.username.toLowerCase() === a[0].toLowerCase())?.entity : bot.nearestEntity(hostile);
      if (!t) return say('Nothing to attack.'); bot.pvp.attack(t); while (!c() && bot.entities[t.id]) await sleep(500); bot.pvp.stop();
    }),
    guard: () => run(async c => { say('Guarding this spot.'); while (!c()) { const m = bot.nearestEntity(e => hostile(e) && e.position.distanceTo(bot.entity.position) < 16); if (m && !bot.pvp.target) bot.pvp.attack(m); await sleep(800); } }),
    drop: a => run(async () => { const n = parseInt(a[a.length - 1]); const it = find(a.filter(x => isNaN(x)).join('_')); if (!it) return say("I don't have that."); await bot.toss(it.type, null, isNaN(n) ? it.count : n); }),
    give: a => run(async c => { const o = ownerEnt(); if (!o) return say("I can't see you."); const n = parseInt(a[a.length - 1]); const it = find(a.filter(x => isNaN(x)).join('_')); if (!it) return say("I don't have that."); await bot.pathfinder.goto(new goals.GoalNear(o.position.x, o.position.y, o.position.z, 2)); await bot.lookAt(o.position.offset(0, 1.6, 0)); await bot.toss(it.type, null, isNaN(n) ? it.count : n); }),
    equip: a => run(async () => { const it = find(a.join('_')); if (!it) return say("I don't have that."); await bot.equip(it, 'hand'); }),
    inv: () => say(bot.inventory.items().map(i => `${i.name}x${i.count}`).join(', ').slice(0, 240) || 'Empty.'),
    sleep: () => run(async () => { const bed = bot.findBlock({ matching: b => b.name.endsWith('_bed'), maxDistance: 32 }); if (!bed) return say('No bed nearby.'); await bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1)); await bot.sleep(bed); }),
    pos: () => { const p = bot.entity.position; say(`${p.x | 0} ${p.y | 0} ${p.z | 0}  HP ${Math.round(bot.health)} Food ${bot.food}`); },
    say: a => bot.chat(a.join(' ').slice(0, 250)),
    jump: () => { bot.setControlState('jump', true); setTimeout(() => bot.setControlState('jump', false), 300); },
  };

  function exec(msg) {
    const [cmd, ...args] = msg.slice(1).trim().split(/\s+/); const f = cmds[cmd.toLowerCase()];
    if (!f) return say('Unknown command. Try !help'); return Promise.resolve(f(args)).catch(e => say('Error: ' + e.message));
  }
  r.runCommand = exec;
  const placeAt = async (it, t) => {
    await bot.equip(it, 'hand');
    for (const d of [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) { const ref = bot.blockAt(t.offset(...d)); if (ref && ref.boundingBox === 'block') { await bot.placeBlock(ref, V(-d[0], -d[1], -d[2])); return true; } }
    return false;
  };
  r.build = (blocks, o, mode) => run(async c => {
    const need = {}; blocks.forEach(b => need[b.name] = (need[b.name] || 0) + 1);
    const list = Object.entries(need).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`);
    r.log(`Build: ${blocks.length} blocks at ${o.x} ${o.y} ${o.z} (${mode}). Materials: ${list.join(', ')}`);
    say(`Building ${blocks.length} blocks. Main materials: ${list.slice(0, 5).join(', ')}`.slice(0, 240));
    if (mode === 'op') {
      for (const b of toBoxes(blocks)) {
        if (c()) return;
        const p1 = `${o.x + b.x1} ${o.y + b.y1} ${o.z + b.z1}`, single = b.x1 === b.x2 && b.y1 === b.y2 && b.z1 === b.z2;
        bot.chat(single ? `/setblock ${p1} ${b.name}${b.state}` : `/fill ${p1} ${o.x + b.x2} ${o.y + b.y2} ${o.z + b.z2} ${b.name}${b.state}`);
        await sleep(1100);
      }
      return say('Build finished. If nothing appeared, I am probably not an operator.');
    }
    let placed = 0; const miss = {};
    for (const b of [...blocks].sort((a, z) => a.y - z.y || a.x - z.x || a.z - z.z)) {
      if (c()) return;
      const t = V(o.x + b.x, o.y + b.y, o.z + b.z); if (bot.blockAt(t)?.name === b.name) continue;
      const it = bot.inventory.items().find(i => i.name === b.name); if (!it) { miss[b.name] = (miss[b.name] || 0) + 1; continue; }
      if (bot.entity.position.distanceTo(t) > 4) await goNear(t, 3).catch(() => {});
      if (await placeAt(it, t).catch(() => false)) placed++;
    }
    const m = Object.entries(miss).map(([k, v]) => `${k} x${v}`).join(', ');
    say(`Placed ${placed}/${blocks.length}.${m ? ' Missing: ' + m : ''}`.slice(0, 240)); if (m) r.log('Missing materials: ' + m);
  });
  function handle(user, msg) {
    if (user === bot.username) return;
    const key = user + msg, now = Date.now(); if (key === lastKey && now - lastAt < 800) return; lastKey = key; lastAt = now;
    const isOwner = !!ownerName() && user.toLowerCase() === ownerName();
    if (msg.startsWith('!')) {
      if (!isOwner) return r.log(`Ignored "${msg}" from ${user} (owner is ${r.cfg.owner || 'not set'})`);
      r.log(`owner: ${msg}`); return exec(msg);
    }
    // Ignore ordinary chat; commands are handled above.
  }
  bot.on('chat', handle); bot.on('whisper', handle);
  bot.on('messagestr', m => { const x = m.match(/^(?:\[[^\]]*\]\s*)*<?(\w{3,16})>?[:»>]?\s+(!.+)$/); if (x) handle(x[1], x[2]); });

  // eat when hungry
  bot.on('health', async () => {
    if (eating || bot.food > 14) return; const f = bot.inventory.items().find(i => bot.registry.foodsByName[i.name]); if (!f) return;
    eating = true; try { await bot.equip(f, 'hand'); await bot.consume(); } catch {} eating = false;
  });
}
