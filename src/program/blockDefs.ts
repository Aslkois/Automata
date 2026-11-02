// Custom block definitions in Blockly's JSON format. Pure data: the Blockly editor registers
// these, and the headless block compiler (compile/blocks.ts) understands the same fields.

const C_EVENT = '#8a6d3b';
const C_SENSE = '#3f7a8c';
const C_MOVE = '#5b7f3a';
const C_WEAPON = '#8c4a3f';
const C_SYS = '#6a5a8c';

const CONTACT_PROPS = [
  ['x', 'x'],
  ['y', 'y'],
  ['distance', 'distance'],
  ['bearing', 'bearing'],
  ['velocity x', 'vx'],
  ['velocity y', 'vy'],
  ['heading', 'heading'],
  ['id', 'id'],
];

export const BLOCK_DEFS: Record<string, unknown>[] = [
  // ------------------------------------------------------------- events
  { type: 'event_start', message0: 'when program starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C_EVENT, tooltip: 'Runs once, before the first decision tick.' },
  { type: 'event_update', message0: 'every decision tick %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C_EVENT, tooltip: 'Runs on every decision update (10 Hz by default).' },
  { type: 'event_failure', message0: 'when hardware fails %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], colour: C_EVENT, tooltip: 'Runs once per hardware failure event, before the decision tick.' },
  {
    type: 'drone_failure_prop',
    message0: 'failure %1',
    args0: [{ type: 'field_dropdown', name: 'PROP', options: [['type', 'type'], ['component', 'component'], ['kind', 'kind'], ['section', 'section'], ['detail', 'detail']] }],
    output: null,
    colour: C_EVENT,
    tooltip: 'Field of the failure being handled (only inside "when hardware fails").',
  },
  // ------------------------------------------------------------- sensing
  { type: 'drone_nearest_enemy', message0: 'nearest enemy', output: 'Contact', colour: C_SENSE, tooltip: 'Closest detected, non-disabled enemy contact, or nothing.' },
  { type: 'drone_enemy_count', message0: 'detected enemy count', output: 'Number', colour: C_SENSE },
  { type: 'drone_threat_count', message0: 'incoming shell count', output: 'Number', colour: C_SENSE, tooltip: 'Interceptable shells on a collision course (radar only).' },
  { type: 'drone_contact_exists', message0: '%1 detected?', args0: [{ type: 'input_value', name: 'CONTACT', check: 'Contact' }], output: 'Boolean', colour: C_SENSE },
  {
    type: 'drone_contact_prop',
    message0: '%1 of %2',
    args0: [{ type: 'field_dropdown', name: 'PROP', options: CONTACT_PROPS }, { type: 'input_value', name: 'CONTACT', check: 'Contact' }],
    output: 'Number',
    colour: C_SENSE,
  },
  {
    type: 'drone_self',
    message0: 'my %1',
    args0: [{ type: 'field_dropdown', name: 'PROP', options: [['x', 'x'], ['y', 'y'], ['heading', 'heading'], ['speed', 'speed'], ['time', 'time']] }],
    output: 'Number',
    colour: C_SENSE,
  },
  { type: 'drone_angle_to', message0: 'angle to x %1 y %2', args0: [{ type: 'input_value', name: 'X', check: 'Number' }, { type: 'input_value', name: 'Y', check: 'Number' }], inputsInline: true, output: 'Number', colour: C_SENSE },
  { type: 'drone_distance_to', message0: 'distance to x %1 y %2', args0: [{ type: 'input_value', name: 'X', check: 'Number' }, { type: 'input_value', name: 'Y', check: 'Number' }], inputsInline: true, output: 'Number', colour: C_SENSE },
  { type: 'drone_angle_diff', message0: 'angle from %1 to %2', args0: [{ type: 'input_value', name: 'A', check: 'Number' }, { type: 'input_value', name: 'B', check: 'Number' }], inputsInline: true, output: 'Number', colour: C_SENSE, tooltip: 'Signed smallest difference in degrees (-180..180].' },
  {
    type: 'drone_weapon_prop',
    message0: 'weapon %1 %2',
    args0: [
      { type: 'field_input', name: 'WEAPON', text: 'F.H1' },
      { type: 'field_dropdown', name: 'PROP', options: [['ready', 'ready'], ['ammo', 'ammo'], ['reserve', 'reserve'], ['heat', 'heat'], ['health', 'health'], ['functional', 'functional'], ['reloading', 'reloading'], ['range', 'range']] },
    ],
    output: null,
    colour: C_WEAPON,
  },
  { type: 'drone_can_fire', message0: 'weapon %1 can fire at %2', args0: [{ type: 'field_input', name: 'WEAPON', text: 'F.H1' }, { type: 'input_value', name: 'CONTACT', check: 'Contact' }], output: 'Boolean', colour: C_WEAPON, tooltip: 'In traverse arc, not obstructed by own sections, loaded and functional.' },
  { type: 'drone_component_ok', message0: 'component %1 functional?', args0: [{ type: 'field_input', name: 'ID', text: 'F.H1' }], output: 'Boolean', colour: C_SYS },
  {
    type: 'drone_count_kind',
    message0: 'working %1 count',
    args0: [{ type: 'field_dropdown', name: 'KIND', options: [['weapon', 'weapon'], ['sensor', 'sensor'], ['motor', 'motor'], ['shield', 'shield'], ['generator', 'generator'], ['controller', 'controller'], ['gear', 'gear']] }],
    output: 'Number',
    colour: C_SYS,
  },
  {
    type: 'drone_status_flag',
    message0: 'I am %1',
    args0: [{ type: 'field_dropdown', name: 'FLAG', options: [['immobilized', 'immobilized'], ['disarmed', 'disarmed'], ['degraded', 'degraded']] }],
    output: 'Boolean',
    colour: C_SYS,
  },
  {
    type: 'drone_power_prop',
    message0: 'power %1',
    args0: [{ type: 'field_dropdown', name: 'PROP', options: [['stored', 'stored'], ['capacity', 'capacity'], ['generation', 'generation']] }],
    output: 'Number',
    colour: C_SYS,
  },
  { type: 'drone_shield_charge', message0: 'shield %1 charge', args0: [{ type: 'field_input', name: 'SHIELD', text: 'M.H1' }], output: 'Number', colour: C_SYS },
  { type: 'drone_elapsed', message0: 'seconds since timer %1', args0: [{ type: 'field_input', name: 'NAME', text: 'timer' }], output: 'Number', colour: C_SYS },
  // ------------------------------------------------------------- movement
  { type: 'drone_drive', message0: 'drive throttle %1 steer %2', args0: [{ type: 'input_value', name: 'THROTTLE', check: 'Number' }, { type: 'input_value', name: 'STEER', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_MOVE, tooltip: 'Throttle and steer in [-1, 1]. Positive steer turns clockwise (right).' },
  { type: 'drone_stop', message0: 'stop', previousStatement: null, nextStatement: null, colour: C_MOVE },
  { type: 'drone_turn_toward_contact', message0: 'drive toward %1 throttle %2', args0: [{ type: 'input_value', name: 'CONTACT', check: 'Contact' }, { type: 'input_value', name: 'THROTTLE', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_MOVE },
  { type: 'drone_turn_toward', message0: 'drive toward x %1 y %2 throttle %3', args0: [{ type: 'input_value', name: 'X', check: 'Number' }, { type: 'input_value', name: 'Y', check: 'Number' }, { type: 'input_value', name: 'THROTTLE', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_MOVE },
  // ------------------------------------------------------------- weapons
  { type: 'drone_aim_at_contact', message0: 'aim weapon %1 at %2 lead %3', args0: [{ type: 'field_input', name: 'WEAPON', text: 'F.H1' }, { type: 'input_value', name: 'CONTACT', check: 'Contact' }, { type: 'field_checkbox', name: 'LEAD', checked: true }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_WEAPON },
  { type: 'drone_aim_angle', message0: 'aim weapon %1 at angle %2', args0: [{ type: 'field_input', name: 'WEAPON', text: 'F.H1' }, { type: 'input_value', name: 'ANGLE', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_WEAPON },
  { type: 'drone_fire', message0: '%1 weapon %2', args0: [{ type: 'field_dropdown', name: 'ON', options: [['fire', 'TRUE'], ['cease fire', 'FALSE']] }, { type: 'field_input', name: 'WEAPON', text: 'F.H1' }], previousStatement: null, nextStatement: null, colour: C_WEAPON },
  { type: 'drone_fire_if', message0: 'fire weapon %1 while %2', args0: [{ type: 'field_input', name: 'WEAPON', text: 'F.H1' }, { type: 'input_value', name: 'COND', check: 'Boolean' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_WEAPON },
  { type: 'drone_reload', message0: 'reload weapon %1', args0: [{ type: 'field_input', name: 'WEAPON', text: 'F.H1' }], previousStatement: null, nextStatement: null, colour: C_WEAPON },
  { type: 'drone_engage_all', message0: 'all weapons engage %1', args0: [{ type: 'input_value', name: 'CONTACT', check: 'Contact' }], previousStatement: null, nextStatement: null, colour: C_WEAPON, tooltip: 'For each working weapon: lead-aim at the contact and fire when it can hit (see prelude source).' },
  // ------------------------------------------------------------- systems
  { type: 'drone_shield_face_contact', message0: 'face shield %1 toward %2', args0: [{ type: 'field_input', name: 'SHIELD', text: 'M.H1' }, { type: 'input_value', name: 'CONTACT', check: 'Contact' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SYS },
  { type: 'drone_shield_raise', message0: '%1 shield %2', args0: [{ type: 'field_dropdown', name: 'ON', options: [['raise', 'TRUE'], ['lower', 'FALSE']] }, { type: 'field_input', name: 'SHIELD', text: 'M.H1' }], previousStatement: null, nextStatement: null, colour: C_SYS },
  { type: 'drone_set_power', message0: 'power priority propulsion %1 weapons %2 shields %3', args0: [{ type: 'input_value', name: 'P', check: 'Number' }, { type: 'input_value', name: 'W', check: 'Number' }, { type: 'input_value', name: 'S', check: 'Number' }], inputsInline: true, previousStatement: null, nextStatement: null, colour: C_SYS },
  { type: 'drone_reset_timer', message0: 'reset timer %1', args0: [{ type: 'field_input', name: 'NAME', text: 'timer' }], previousStatement: null, nextStatement: null, colour: C_SYS },
  { type: 'drone_log', message0: 'log %1', args0: [{ type: 'input_value', name: 'VALUE' }], previousStatement: null, nextStatement: null, colour: C_SYS },
  { type: 'list_item', message0: 'item # %1 of list %2', args0: [{ type: 'input_value', name: 'INDEX', check: 'Number' }, { type: 'input_value', name: 'LIST' }], inputsInline: true, output: null, colour: '#745ba5', tooltip: '1-based index.' },
];

/** Standard Blockly blocks supported by the compiler. */
export const STANDARD_BLOCKS = [
  'controls_if', 'controls_repeat_ext', 'controls_whileUntil', 'controls_for', 'controls_forEach', 'controls_flow_statements',
  'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary',
  'math_number', 'math_arithmetic', 'math_single', 'math_trig', 'math_round', 'math_modulo', 'math_constrain', 'math_random_float',
  'text', 'text_join', 'variables_get', 'variables_set', 'math_change', 'lists_create_with', 'lists_length',
  'procedures_defnoreturn', 'procedures_defreturn', 'procedures_callnoreturn', 'procedures_callreturn', 'procedures_ifreturn',
];

export const TOOLBOX_CATEGORIES: { name: string; colour: string; blocks: string[]; custom?: string }[] = [
  { name: 'Events', colour: C_EVENT, blocks: ['event_update', 'event_start', 'event_failure', 'drone_failure_prop'] },
  { name: 'Logic', colour: '#5b80a5', blocks: ['controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean', 'logic_null', 'logic_ternary'] },
  { name: 'Loops', colour: '#5ba55b', blocks: ['controls_repeat_ext', 'controls_whileUntil', 'controls_for', 'controls_forEach', 'controls_flow_statements'] },
  { name: 'Math', colour: '#5b67a5', blocks: ['math_number', 'math_arithmetic', 'math_single', 'math_trig', 'math_round', 'math_modulo', 'math_constrain', 'math_random_float'] },
  { name: 'Text & Lists', colour: '#745ba5', blocks: ['text', 'text_join', 'lists_create_with', 'lists_length', 'list_item'] },
  { name: 'Sensors', colour: C_SENSE, blocks: ['drone_nearest_enemy', 'drone_contact_exists', 'drone_contact_prop', 'drone_enemy_count', 'drone_threat_count', 'drone_self', 'drone_angle_to', 'drone_distance_to', 'drone_angle_diff'] },
  { name: 'Movement', colour: C_MOVE, blocks: ['drone_drive', 'drone_turn_toward_contact', 'drone_turn_toward', 'drone_stop'] },
  { name: 'Weapons', colour: C_WEAPON, blocks: ['drone_engage_all', 'drone_aim_at_contact', 'drone_aim_angle', 'drone_fire', 'drone_fire_if', 'drone_reload', 'drone_can_fire', 'drone_weapon_prop'] },
  { name: 'Systems', colour: C_SYS, blocks: ['drone_shield_face_contact', 'drone_shield_raise', 'drone_set_power', 'drone_shield_charge', 'drone_power_prop', 'drone_status_flag', 'drone_count_kind', 'drone_component_ok', 'drone_reset_timer', 'drone_elapsed', 'drone_log'] },
  { name: 'Variables', colour: '#a55b80', blocks: [], custom: 'VARIABLE' },
  { name: 'Functions', colour: '#995ba5', blocks: [], custom: 'PROCEDURE' },
];
