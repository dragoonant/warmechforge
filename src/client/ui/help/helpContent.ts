// How to Play: our own words, tabbed and skimmable. Plain data (no React) so a test can check it.
// The numbers here describe the standing rules in general terms. In play, every target number, odds value and cost is
// shown by the game itself, so this guide teaches the ideas and where to look, not a table to memorise.

export type HelpBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  | { kind: 'tip'; text: string }
  | { kind: 'keys'; rows: [string, string][] }
  | { kind: 'table'; head: string[]; rows: string[][] }

export interface HelpTab { id: string; title: string; blurb: string; blocks: HelpBlock[] }

export const HELP_TABS: HelpTab[] = [
  {
    id: 'goal',
    title: 'Goal',
    blurb: 'Two small lances of giant walking war machines meet on a hex map. Last side still able to fight wins.',
    blocks: [
      { kind: 'p', text: 'You command a lance of \'Mechs. So does the enemy. Each \'Mech is a piloted walking tank with armor, bones, a reactor that makes heat, and a handful of weapons. You move them across a map of hexes, shoot, and sometimes slam into each other.' },
      { kind: 'h', text: 'How you win' },
      { kind: 'list', items: [
        'Knock out every enemy \'Mech. A \'Mech is out when its head or center torso is destroyed, its cockpit is hit, its pilot dies, or its engine takes three critical hits.',
        'Or leave the enemy too hurt to fight. In the Intro mission a crippled \'Mech counts as out: one with a destroyed leg, a destroyed gyro, two engine hits, or no weapon left that can fire.',
        'If both sides lose their last fighter together, or neither can hurt the other any more, it is a draw.',
      ] },
      { kind: 'h', text: 'The two missions' },
      { kind: 'list', items: [
        'Intro mission: a small fixed fight on a canyon map. The best place to learn.',
        'Skirmish: pick the two forces and the map, then fight it out under a points budget.',
      ] },
      { kind: 'tip', text: 'Nothing here needs memorising. When you aim, the game shows your target number, the odds in percent, and every bonus or penalty behind them. Read those and decide.' },
    ],
  },
  {
    id: 'sheet',
    title: 'Your \'Mech',
    blurb: 'Each \'Mech has a record sheet. Click a \'Mech and its sheet opens on the right.',
    blocks: [
      { kind: 'p', text: 'The sheet is a diagram of one machine: how much armor is left, how much frame is left under the armor, what is installed where, and how the pilot is doing.' },
      { kind: 'h', text: 'Armor and internal structure' },
      { kind: 'p', text: 'There are eight body locations: head, center torso, left and right torso, left and right arm, left and right leg. Each has a layer of armor over a layer of internal structure. The three torsos have a second, thinner armor layer on the back, so a shot from behind finds less protection.' },
      { kind: 'h', text: 'Critical slots' },
      { kind: 'p', text: 'Every location is a grid of slots holding gear: weapons, ammo bins, heat sinks, the engine, the gyro, the cockpit, actuators in the limbs. Torsos and arms have twelve slots, the head and legs have six. When a hit gets through the armor it may "crit" a slot and break whatever sits there.' },
      { kind: 'h', text: 'Heat sinks' },
      { kind: 'p', text: 'Heat sinks bleed off heat at the end of each turn. Single sinks remove 1 each, double sinks 2. Lose sinks and the \'Mech runs hotter. The sheet shows the total it can shed per turn.' },
      { kind: 'h', text: 'Pilot' },
      { kind: 'list', items: [
        'Gunnery (the G number, lower is better) sets how hard it is to hit with weapons.',
        'Piloting (the P number, lower is better) sets how hard it is to stay on your feet and to land charges and kicks.',
        'Six hit boxes. Under each box is the number the pilot must roll to stay conscious at that many hits. At six the pilot is dead and the \'Mech is lost.',
      ] },
      { kind: 'h', text: 'Movement points' },
      { kind: 'p', text: 'Walk, Run and Jump values on the sheet are how many movement points (MP) the \'Mech has in each mode. Heat and leg damage lower them; a lowered value shows next to the normal one.' },
      { kind: 'tip', text: 'Hover a body part on the paper doll to see its exact armor and structure numbers.' },
    ],
  },
  {
    id: 'turn',
    title: 'Turn sequence',
    blurb: 'Every turn runs through the same six steps, in this order.',
    blocks: [
      { kind: 'steps', items: [
        'Initiative. Each side rolls two dice. The higher roll wins. The loser must act first in each of the next three steps; the winner acts last, which is the better seat because it sees what the other side did.',
        'Movement. Sides take turns picking one \'Mech at a time and moving it completely. The side with more \'Mechs gets to move extra ones early, so the counts even out.',
        'Ranged attacks. Same alternating order: each \'Mech declares its shots. Once everyone has declared, the shots are all resolved.',
        'Physical attacks. Punches, kicks and shoves against adjacent enemies, declared the same way and then resolved. Charges and jump attacks were declared back in Movement.',
        'Heat. Every \'Mech adds the heat it made this turn, subtracts what its sinks remove, and checks for shutdown or ammo explosion if it is very hot.',
        'End. Knocked-out pilots try to wake, torsos twist back to face forward, \'Mechs may power down or restart, and the game checks whether someone has won.',
      ] },
      { kind: 'tip', text: 'Damage lands at once but its effects (broken weapons, lost movement) take hold only after the whole step is resolved. A \'Mech that is about to die still gets its shots in.' },
    ],
  },
  {
    id: 'move',
    title: 'Moving',
    blurb: 'Pick a mode, click a hex, choose which way to face, confirm.',
    blocks: [
      { kind: 'h', text: 'Modes' },
      { kind: 'table', head: ['Mode', 'Reach', 'Shoots at', 'Heat'], rows: [
        ['Stand still', 'none', 'no penalty', '0'],
        ['Walk', 'up to Walk MP', '+1 to hit', '1'],
        ['Run', 'up to Run MP, forward only', '+2 to hit', '2'],
        ['Jump', 'up to Jump MP, over anything', '+3 to hit', 'at least 3'],
      ] },
      { kind: 'p', text: 'Unspent MP are lost. A \'Mech that starts the turn on the ground can only walk or run, and one that jumps must start upright.' },
      { kind: 'h', text: 'Facing and hexsides' },
      { kind: 'p', text: 'A \'Mech faces a hexside, not a hex corner. Moving straight ahead (or straight back, when walking) costs the hex. Turning one hexside costs 1 MP, however far around. Facing matters twice: it decides where your guns can point, and which side of you the enemy hits.' },
      { kind: 'h', text: 'What hexes cost' },
      { kind: 'list', items: [
        'Open ground: 1 MP. Rough ground and light woods: 1 extra. Heavy woods: 2 extra.',
        'Climbing or dropping one level: 1 extra. Two levels is the most a \'Mech can change in one step; steeper is not allowed.',
        'Shallow water: 1 extra, and running into it calls for a piloting roll. Rubble: 1 extra and a piloting roll.',
        'Jumping ignores terrain: it costs 1 MP per hex of straight-line distance, but you cannot jump higher than your jump MP over the highest hex on the way.',
      ] },
      { kind: 'p', text: 'The highlighted hexes show exactly where you can go, green for a walk, amber for a run, blue for a jump. Hover a hex to see the path and what each step costs.' },
      { kind: 'h', text: 'Why movement is also defence' },
      { kind: 'p', text: 'The more hexes you cross, the harder you are to hit. This is the target movement modifier:' },
      { kind: 'table', head: ['Hexes moved', '0-2', '3-4', '5-6', '7-9', '10-17', '18-24', '25+'], rows: [['Enemy to-hit', '+0', '+1', '+2', '+3', '+4', '+5', '+6']] },
      { kind: 'p', text: 'A \'Mech that jumped is harder to hit by one more. The trade: moving fast makes your own aim worse and your heat higher.' },
      { kind: 'h', text: 'Prone and standing up' },
      { kind: 'list', items: [
        'Dropping prone on purpose costs 1 MP. Prone \'Mechs shoot worse, cannot punch or kick, and cannot twist.',
        'Standing up costs 2 MP and a piloting roll, with a small bonus. Fail and you fall again where you are. It makes no extra heat.',
        'A prone \'Mech is easier to hit from next to it and a little harder from range.',
      ] },
      { kind: 'h', text: 'Charge and death from above' },
      { kind: 'p', text: 'If your move ends next to an enemy that has already moved, the game can offer to turn it into a charge (walk or run) or a jump attack. These are declared with the move and resolved with the physical attacks. See the Physical attacks tab.' },
    ],
  },
  {
    id: 'shoot',
    title: 'Shooting',
    blurb: 'Click an enemy, tick the weapons, read the odds, fire.',
    blocks: [
      { kind: 'h', text: 'The roll' },
      { kind: 'p', text: 'Each weapon rolls two dice on its own. It hits if the total meets or beats the target number (TN). Your TN starts at the pilot\'s Gunnery and gets bonuses added for everything that makes the shot harder. The game lists every one and shows the odds as a percentage. A TN of 13 or more cannot be attempted; a TN of 2 or less always hits.' },
      { kind: 'h', text: 'Arcs and torso twist' },
      { kind: 'list', items: [
        'Torso and head weapons shoot into the front arc, the 120 degree cone ahead of the torso. Arm weapons also cover their own side.',
        'Rear-mounted weapons shoot only behind you.',
        'Before shooting you may twist the torso one hexside left or right. The legs stay put, so the enemy still hits you as if you had not turned. Twisting is free but you can do it once per turn.',
        'Arm flip: a \'Mech with simple arms can swing them round to fire backward.',
      ] },
      { kind: 'h', text: 'Line of sight' },
      { kind: 'p', text: 'A line runs from your hex centre to theirs. A hill higher than both of you blocks it. Woods in between add a penalty, and three or more points of woods (a light woods hex is 1, heavy is 2) block it completely. The overlay colours the line: green is clear, amber is clear with penalties, red is blocked. Sometimes the line runs exactly along a hex edge; then the defender picks the way it counts.' },
      { kind: 'h', text: 'Range' },
      { kind: 'p', text: 'Every weapon has short, medium and long range in hexes, and a few have a minimum range. Medium adds +2, long adds +4. Closer than the minimum range adds a penalty for each hex inside it. Past long range you cannot fire.' },
      { kind: 'h', text: 'What changes the odds' },
      { kind: 'table', head: ['Situation', 'Effect'], rows: [
        ['You walked / ran / jumped', '+1 / +2 / +3'],
        ['Target moved far', 'up to +6 (see Moving)'],
        ['Target in light / heavy woods', '+1 / +2'],
        ['Woods between you', '+1 or +2 per hex'],
        ['Target in partial cover', '+1'],
        ['Your \'Mech is hot (8, 13, 17, 24)', '+1 / +2 / +3 / +4'],
        ['Shooting a second target', '+1 each'],
        ['Target prone, adjacent / at range', '-2 / +1'],
        ['Target immobile (shut down, pilot out)', '-4'],
        ['Damaged sensors or arm joints', 'worse aim'],
      ] },
      { kind: 'h', text: 'Hit locations' },
      { kind: 'p', text: 'A hit rolls two dice again for where it lands. Which table depends on the side you are hitting: front or rear, left, or right. A hit roll of 7 is the middle of the body on the front. A 12 is the head, and a natural 2 is a lucky shot through the armor that may break something even though armor is left.' },
      { kind: 'h', text: 'Clusters' },
      { kind: 'p', text: 'Missiles and some autocannons fire a bundle. One hit roll, then another to see how many of the bundle landed. Each group of hits then rolls its own location, so one volley can shred several places at once.' },
      { kind: 'tip', text: 'Firing the weapon makes heat whether it hits or not. The live heat total above the weapon list shows where you will end up.' },
    ],
  },
  {
    id: 'damage',
    title: 'Damage',
    blurb: 'Armor first, then the bones, then the machinery inside.',
    blocks: [
      { kind: 'steps', items: [
        'Damage takes off armor in the location that was hit (the rear armor if you were hit from behind in a torso).',
        'What armor cannot stop goes into internal structure.',
        'If structure was damaged, the location may take a critical hit check.',
        'If structure runs out, the location is destroyed, and what is left over passes inward to the next location.',
      ] },
      { kind: 'list', items: [
        'An arm or leg passes excess to its side torso. A side torso passes to the center torso.',
        'A destroyed side torso takes its arm with it.',
        'Head or center torso gone: the \'Mech is destroyed.',
        'Any hit to the head, even one absorbed entirely by armor, jolts the pilot for 1 hit.',
      ] },
      { kind: 'h', text: 'Critical hits' },
      { kind: 'p', text: 'When a crit check is called for, roll two dice. A low result does nothing, 8 or 9 is one critical hit, 10 or 11 is two, and 12 on a torso is three. A 12 on a limb or head blows it clean off. Each critical hit lands in a random slot of that location and breaks what is in it.' },
      { kind: 'table', head: ['Part hit', 'What happens'], rows: [
        ['Weapon or equipment', 'out of action'],
        ['Heat sink', 'the \'Mech sheds less heat'],
        ['Arm joints', 'worse aim, weaker punches'],
        ['Leg joints and hips', 'less movement and a harder time staying upright'],
        ['Engine', 'extra heat each turn; three hits destroys the \'Mech'],
        ['Gyro', 'harder piloting rolls; a second hit drops the \'Mech for good'],
        ['Sensors', 'worse aim; two hits means no shooting'],
        ['Cockpit', 'pilot killed'],
        ['Jump jet', 'one less jump MP'],
      ] },
      { kind: 'h', text: 'Ammo explosions' },
      { kind: 'p', text: 'An ammo bin that is hit while it still has shots can blow up. The blast is bigger the fuller the bin (the damage is capped at 20) and goes straight to the structure of that location, skipping the armor. It also jolts the pilot. Energy weapons carry no ammo, so a \'Mech built only on lasers has nothing to explode.' },
      { kind: 'tip', text: 'A torso full of ammo is both a target and a risk. Fire off ammo you cannot use, or turn that side away from the enemy.' },
    ],
  },
  {
    id: 'heat',
    title: 'Heat',
    blurb: 'Heat is the price of firepower. Spend it carefully.',
    blocks: [
      { kind: 'p', text: 'Each turn you add heat from moving (walk 1, run 2, jump at least 3), from every weapon you fired, and from damaged engines. At the Heat step the \'Mech sheds as much as its heat sinks can remove. What is left stays on the heat scale for next turn.' },
      { kind: 'h', text: 'The heat scale' },
      { kind: 'table', head: ['Heat', 'What it does'], rows: [
        ['5, 10, 15, 20, 25', 'Walk MP drops by 1, 2, 3, 4, 5'],
        ['8, 13, 17, 24', 'Your shots get +1, +2, +3, +4 harder'],
        ['14, 18, 22, 26', 'Risk of shutdown (needs a roll of 4, 6, 8, 10 or more to stay on)'],
        ['19, 23, 28', 'Risk of an ammo explosion (needs 4, 6, 8)'],
        ['30', 'Automatic shutdown'],
      ] },
      { kind: 'p', text: 'The right rail shows the scale with a marker for where you are and a ghost marker for where your current plan will leave you. The prompt lists the effects at that level.' },
      { kind: 'h', text: 'Shutdown' },
      { kind: 'list', items: [
        'A shut-down \'Mech cannot move, fire or punch. It is easy to hit: -4 on the dice, and aimed shots become possible.',
        'It still cools. It restarts on the next Heat step if it has cooled below 14, or on a roll if it is still hot.',
        'You may also power down on purpose in the End step to dump heat, at the cost of sitting helpless for a turn.',
      ] },
      { kind: 'tip', text: 'Heat 8 is the first real line: a +1 penalty on every shot. Many players fire everything on turn one, then back off with half the guns for a turn or two.' },
    ],
  },
  {
    id: 'falls',
    title: 'Piloting rolls & falls',
    blurb: 'Big hits and rough ground can knock a \'Mech off its feet.',
    blocks: [
      { kind: 'h', text: 'When you roll' },
      { kind: 'list', items: [
        'Taking 20 or more damage in a single step.',
        'A critical hit on the gyro, hip, or leg.',
        'Being kicked, shoved, charged or hit by a jump attack. Making a kick that misses, or a successful charge or jump attack.',
        'Standing up, running into water, crossing rubble, a backward step down a level, landing a jump in water.',
        'Running with a hurt gyro, hip or leg, or jumping with a hurt leg.',
        'A leg destroyed or the gyro wrecked: no roll, down you go.',
      ] },
      { kind: 'p', text: 'The roll is two dice against a target number. It starts at the pilot\'s Piloting skill and adds penalties for damage and for what just happened. The game prints the number and odds before the roll. A target above 12 is an automatic fall.' },
      { kind: 'h', text: 'A fall' },
      { kind: 'list', items: [
        'The \'Mech ends up prone, facing the way it was.',
        'It takes damage based on its weight, applied in groups of 5, from a random side. Falling into water takes less.',
        'The pilot rolls a "seatbelt" check; fail and they take 1 hit.',
        'Prone \'Mechs ignore further piloting rolls except when they try to stand.',
      ] },
      { kind: 'h', text: 'Pilot wounds' },
      { kind: 'p', text: 'After a phase in which the pilot took hits, the pilot rolls to stay conscious. The number needed rises with the hits: 1 hit needs 3, then 5, 7, 10, 11. An unconscious pilot means the \'Mech cannot act. It tries to wake each End step. A pilot with six hits is dead.' },
    ],
  },
  {
    id: 'melee',
    title: 'Physical attacks',
    blurb: 'Close enough to touch? Punch, kick, shove, charge, or jump on them.',
    blocks: [
      { kind: 'p', text: 'These use the pilot\'s Piloting skill instead of Gunnery, and are only against a neighbouring hex. Heat does not affect them. Each \'Mech makes one kind per turn, and you cannot use an arm that fired a weapon this turn.' },
      { kind: 'table', head: ['Attack', 'Damage', 'Notes'], rows: [
        ['Punch', 'about a tenth of its weight, each arm', 'target in front or the arm\'s side; arm joint damage weakens it'],
        ['Kick', 'about a fifth of its weight', 'target dead ahead of the feet; if you miss, you must roll to stay up'],
        ['Push', 'none', 'target moves back one hex and must roll; you step forward'],
        ['Charge', 'scales with how far you moved', 'declared in Movement; both sides take damage and roll to stay up'],
        ['Death from above', 'heavy, to both of you', 'a jump attack, declared in Movement; a miss makes you fall'],
      ] },
      { kind: 'list', items: [
        'Heights matter. Punches can reach a target one level higher than you and kicks one level lower; charges and jump attacks cover more.',
        'A target pushed or hit by a charge is moved one hex directly away. If a \'Mech is already there, it may be shoved too, or step aside after a successful roll.',
        'A \'Mech that cannot be moved to a legal hex is destroyed.',
      ] },
      { kind: 'tip', text: 'A kick can topple a 100-tonner. A miss can topple you. Read the risk line on each option before choosing.' },
    ],
  },
  {
    id: 'controls',
    title: 'Controls',
    blurb: 'Mouse for the board, keys for speed.',
    blocks: [
      { kind: 'h', text: 'Mouse' },
      { kind: 'list', items: [
        'Left click: select a \'Mech, pick a hex, pick a target, press buttons.',
        'Right-drag: orbit the camera. Middle-drag or W A S D: pan. Wheel: zoom.',
        'Hover a \'Mech for a quick status card, a hex for terrain and move costs.',
      ] },
      { kind: 'h', text: 'Keyboard' },
      { kind: 'keys', rows: [
        ['Enter', 'Confirm the move or shots'],
        ['Esc', 'Cancel, or skip the current batch of animation'],
        ['Space', 'Skip the animation beat that is playing'],
        ['Q / E', 'Rotate through the facings you can pick'],
        [', / .', 'Twist the torso left or right'],
        ['M / L / G / R', 'Ruler, line of sight, grid lines, weapon range rings'],
        ['1 / 2 / 3 / 0', 'Camera: top down, your edge, follow the active \'Mech, overview'],
        ['Tab / Shift+Tab', 'Cycle your \'Mechs / enemy \'Mechs'],
        ['[ / ]', 'Collapse the left / right rail'],
        ['?', 'Open or close this guide'],
      ] },
      { kind: 'h', text: 'Skipping animations' },
      { kind: 'p', text: 'Click anywhere or press Space to skip the current beat. Esc skips everything queued. In Settings the speed can be Slow, Normal, Fast, Faster or Skip animations, which plays every result at once.' },
      { kind: 'tip', text: 'The coach line at the bottom tells you what the game is waiting for. Dismiss any hint with the x; it stays gone. You can turn them all off, or on again, from the same line or in Settings.' },
    ],
  },
  {
    id: 'first',
    title: 'Your first turn',
    blurb: 'A walk through turn one of the Intro mission.',
    blocks: [
      { kind: 'steps', items: [
        'Start the Intro mission. Your two \'Mechs come in from the edge of the map nearest you; the enemy comes from the far edge.',
        'Initiative: both sides roll. If you lost, you move first. The banner tells you.',
        'Movement: click one of your \'Mechs from the list that is marked as ready to move.',
        'Choose Walk. Green hexes light up. Pick one toward cover, such as woods, but not too deep: heavy woods cost extra.',
        'The facing arrows appear around the hex. Face the enemy, or the way your guns are mounted. Press Confirm move (or Enter).',
        'Move your second \'Mech the same way. Keep them within a few hexes of each other.',
        'Ranged attacks: when a \'Mech is picked, click an enemy in range. Weapons that can fire are ticked; the TN, odds and heat are shown. Press Fire. If nothing is in range or line of sight, press Hold fire. It is a fair choice.',
        'Physical attacks: if an enemy is next to you, compare the options and the risk lines. Otherwise choose None.',
        'Heat and End run by themselves. Check the heat scale in the right rail before the next turn.',
      ] },
      { kind: 'tip', text: 'Your first goal is not to win the turn. Close the distance in good terrain, keep the guns facing the enemy, and keep your heat at or below 7 while you learn.' },
      { kind: 'p', text: 'Stuck at any moment? The coach line at the bottom explains what the game wants next, and the ? key brings back this guide.' },
    ],
  },
]

/** All plain text of a tab (for tests and search). */
export function tabText(t: HelpTab): string {
  const out: string[] = [t.title, t.blurb]
  for (const b of t.blocks) {
    switch (b.kind) {
      case 'p': case 'h': case 'tip': out.push(b.text); break
      case 'list': case 'steps': out.push(...b.items); break
      case 'keys': for (const r of b.rows) out.push(...r); break
      case 'table': out.push(...b.head); for (const r of b.rows) out.push(...r); break
    }
  }
  return out.join('\n')
}
