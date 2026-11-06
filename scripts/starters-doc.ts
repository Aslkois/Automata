// Writes docs/STARTERS.md from the roster's own data (hardware, brains and STARTER_INFO), so the
// documentation cannot drift from what ships. Run: npx vite-node scripts/starters-doc.ts
import { writeFileSync } from 'node:fs';
import { DEFAULT_BRAINS, DEFAULT_DESIGNS, STARTER_INFO } from '../src/data/defaults';
import { getComponent } from '../src/sim/content/components';
import { computeStats, type SectionDesign } from '../src/sim/design';

const out: string[] = [];
const say = (s = '') => out.push(s);
const VIEW: Record<string, string> = { blocks: 'Blocks', nodes: 'Nodes', code: 'Code', configure: 'Configure' };
const parts = (s: SectionDesign) =>
  Object.entries(s.slots)
    .filter(([, m]) => m)
    .map(([slot, m]) => `${slot} ${getComponent(m!.component).name}${m!.rotation ? ` (${m!.rotation}°)` : ''}${m!.payload ? ` [${m!.payload}]` : ''}${m!.interceptors ? ` [${m!.interceptors} interceptors]` : ''}`)
    .join(', ') || '—';

say('# Starter drones');
say();
say(`AUTOMATA ships ${DEFAULT_DESIGNS.length} starter drones. Each one is a coherent machine built around one combat problem, with its own hand-written brain; together they climb from a dozen-line beginner program to expert brains with memory and utility scoring. All of them use only the public drone API and what their own sensors report — no starter sees through walls, reads enemy health or knows where an unseen enemy is.`);
say();
say('This page is generated from the roster’s own data by `scripts/starters-doc.ts`. Measured results against each other are in [EVALUATION.md](EVALUATION.md).');
say();
say('| Starter | Complexity | Chassis | Role | Mass | Top speed | Brain | Opens in |');
say('|---|---|---|---|---|---|---|---|');
for (const d of DEFAULT_DESIGNS) {
  const i = STARTER_INFO.find((x) => x.designId === d.id)!;
  const b = DEFAULT_BRAINS.find((x) => x.designId === d.id)!;
  const s = computeStats(d);
  say(`| [${d.name}](#${d.name.toLowerCase()}) | ${i.complexity} | ${d.chassis} | ${i.role} | ${(s.mass / 1000).toFixed(2)} t | ${Math.round(s.topSpeed)} u/s | ${b.code.split('\n').length} lines | ${VIEW[b.view]} |`);
}
say();
for (const level of ['beginner', 'intermediate', 'advanced', 'expert'] as const) {
  say(`## ${level[0].toUpperCase() + level.slice(1)}`);
  say();
  for (const d of DEFAULT_DESIGNS) {
    const i = STARTER_INFO.find((x) => x.designId === d.id)!;
    if (i.complexity !== level) continue;
    say(`### ${d.name}`);
    say();
    say(`*${i.role}* · ${d.chassis}`);
    say();
    say(`- **Problem it solves:** ${i.problem}`);
    say(`- **Engineering:** ${i.engineering}`);
    say(`- **Behaviour:** ${i.behaviour}`);
    say(`- **Strengths:** ${i.strengths}`);
    say(`- **Weaknesses:** ${i.weaknesses}`);
    say(`- **Learning focus:** ${i.learning}`);
    say();
    say('| Section | Class / layout | Armour | Equipment |');
    say('|---|---|---|---|');
    for (const pos of ['front', 'middle', 'rear'] as const) {
      const s = d.sections[pos];
      say(`| ${pos} | ${s.class} / ${s.layout}${s.mirror ? ' (mirrored)' : ''} | ${s.armor} mm | ${parts(s)} |`);
    }
    say();
  }
}
say('## How the roster was put together');
say();
say('- **No quota.** Each starter answers a different question: what problem it solves, why its chassis, why every part is there, how it fights, what it does when the matchup is bad, what it teaches, and why the roster needs it. Designs that could not answer all seven were not kept.');
say('- **All four chassis are used on purpose:** wheels for speed and duels (Picket, Rapier, Kestrel, Jackal, Talon, Viper, Paragon), tracks for armour that must arrive (Bulldog, Mauler, Warden), legs for braced firing platforms (Citadel, Longbow, Juggernaut), and thrusters for speed above all (Gnat, Hornet).');
say('- **Every part is used by the brain.** A unit test fails if a starter carries a weapon or shield its brain never addresses.');
say('- **The brains are separate programs,** not one template with different numbers: they share helper functions from the standard library, but the decision logic of each is its own (see the program-similarity line in EVALUATION.md).');
say('- **Distinct behaviour is measured,** not assumed: EVALUATION.md fingerprints each starter’s movement, range, facing and fire from simulation telemetry.');
say();
say('## Retired starters');
say();
say('The previous eleven examples (Assault Platform, AA Destroyer, Skirmisher, Strider, Wisp, Pathfinder, Needle, Aegis, Mantis, Harrier, Bastion) are no longer registered. A library that still holds them unchanged has them retired on load — their programs are kept under **Program → Recovered**, and the whole library is backed up first in `localStorage` as `automata.library.before-roster-3`. Any old example you changed in any way (design or program) stays in your library as your own drone.');
writeFileSync('docs/STARTERS.md', out.join('\n') + '\n');
console.log(`wrote docs/STARTERS.md (${out.length} lines)`);
