import { useEffect, useRef } from 'react';
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { BLOCK_DEFS, TOOLBOX_CATEGORIES } from '../../program/blockDefs';
import type { BlocksState } from '../../program/types';

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  Blockly.common.defineBlocksWithJsonArray(BLOCK_DEFS);
}

const num = (n: number) => ({ shadow: { type: 'math_number', fields: { NUM: n } } });
const DEFAULT_INPUTS: Record<string, Record<string, unknown>> = {
  drone_drive: { THROTTLE: num(1), STEER: num(0) },
  drone_turn_toward_contact: { CONTACT: { block: { type: 'drone_nearest_enemy' } }, THROTTLE: num(1) },
  drone_turn_toward: { X: num(900), Y: num(550), THROTTLE: num(0.6) },
  drone_aim_at_contact: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_aim_angle: { ANGLE: num(0) },
  drone_engage_all: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_shield_face_contact: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_set_power: { P: num(1), W: num(1), S: num(1) },
  drone_contact_exists: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_contact_prop: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_can_fire: { CONTACT: { block: { type: 'drone_nearest_enemy' } } },
  drone_angle_to: { X: num(0), Y: num(0) },
  drone_distance_to: { X: num(0), Y: num(0) },
  drone_angle_diff: { A: num(0), B: num(0) },
  drone_log: { VALUE: { shadow: { type: 'text', fields: { TEXT: 'hello' } } } },
  controls_repeat_ext: { TIMES: num(3) },
  math_arithmetic: { A: num(1), B: num(1) },
  math_single: { NUM: num(9) },
  math_trig: { NUM: num(45) },
  math_round: { NUM: num(3.1) },
  math_modulo: { DIVIDEND: num(64), DIVISOR: num(10) },
  math_constrain: { VALUE: num(50), LOW: num(1), HIGH: num(100) },
  controls_for: { FROM: num(1), TO: num(10), BY: num(1) },
  list_item: { INDEX: num(1) },
};

function toolbox() {
  return {
    kind: 'categoryToolbox',
    contents: TOOLBOX_CATEGORIES.map((c) =>
      c.custom
        ? { kind: 'category', name: c.name, colour: c.colour, custom: c.custom }
        : { kind: 'category', name: c.name, colour: c.colour, contents: c.blocks.map((type) => ({ kind: 'block', type, ...(DEFAULT_INPUTS[type] ? { inputs: DEFAULT_INPUTS[type] } : {}) })) },
    ),
  };
}

const style = (primary: string, secondary: string, tertiary: string) => ({ colourPrimary: primary, colourSecondary: secondary, colourTertiary: tertiary });
const BLOCK_STYLES = {
  event_blocks: style('#ff8a1f', '#ffb066', '#b85e0e'),
  sensor_blocks: style('#18c29c', '#5fd9bb', '#0f8a6f'),
  move_blocks: style('#2f6bff', '#6d97ff', '#1b45b8'),
  weapon_blocks: style('#ff5c8a', '#ff8fae', '#c43c63'),
  system_blocks: style('#6fa8ff', '#9cc3ff', '#3f78cf'),
  data_blocks: style('#9aa3c7', '#bcc2dc', '#66709a'),
  logic_blocks: style('#b45cff', '#cd8fff', '#7d36bd'),
  loop_blocks: style('#b45cff', '#cd8fff', '#7d36bd'),
  math_blocks: style('#ffd23f', '#ffe27f', '#c79b12'),
  text_blocks: style('#9aa3c7', '#bcc2dc', '#66709a'),
  list_blocks: style('#9aa3c7', '#bcc2dc', '#66709a'),
  variable_blocks: style('#ff9ec0', '#ffc2d7', '#c4607f'),
  variable_dynamic_blocks: style('#ff9ec0', '#ffc2d7', '#c4607f'),
  procedure_blocks: style('#c4a7ff', '#dccaff', '#8a6ad1'),
  colour_blocks: style('#9aa3c7', '#bcc2dc', '#66709a'),
  hat_blocks: style('#ff8a1f', '#ffb066', '#b85e0e'),
};

const theme = () =>
  Blockly.Theme.defineTheme('automata-bench', {
    name: 'automata-bench',
    base: Blockly.Themes.Classic,
    blockStyles: BLOCK_STYLES,
    componentStyles: {
      workspaceBackgroundColour: '#1b2030',
      toolboxBackgroundColour: '#23262f',
      toolboxForegroundColour: '#f7f7f2',
      flyoutBackgroundColour: '#15161c',
      flyoutForegroundColour: '#f7f7f2',
      flyoutOpacity: 0.97,
      scrollbarColour: '#454a5a',
      scrollbarOpacity: 0.9,
      insertionMarkerColour: '#ffd23f',
      insertionMarkerOpacity: 0.5,
      cursorColour: '#ffd23f',
      selectedGlowColour: '#ffd23f',
    },
    fontStyle: { family: 'Bricolage Grotesque, system-ui, sans-serif', weight: '650', size: 12 },
    startHats: true,
  });

export function BlockEditor({ state, onChange, highlight, visible }: { state: BlocksState; onChange: (s: BlocksState) => void; highlight: string | null; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loading = useRef(false);

  useEffect(() => {
    register();
    const w = Blockly.inject(host.current!, {
      toolbox: toolbox() as Blockly.utils.toolbox.ToolboxDefinition,
      theme: theme(),
      renderer: 'thrasos',
      trashcan: true,
      sounds: false,
      grid: { spacing: 24, length: 2.5, colour: '#2b3247', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 2, minScale: 0.3 },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    ws.current = w;
    loading.current = true;
    try {
      Blockly.serialization.workspaces.load(state as object, w);
    } catch (e) {
      console.error('Failed to load block program', e);
    }
    loading.current = false;
    const listener = (e: Blockly.Events.Abstract) => {
      if (loading.current || e.isUiEvent) return;
      onChangeRef.current(Blockly.serialization.workspaces.save(w) as BlocksState);
    };
    w.addChangeListener(listener);
    return () => {
      w.dispose();
      ws.current = null;
    };
    // The workspace is (re)created per program; parent keys this component by program id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible && ws.current) Blockly.svgResize(ws.current);
  }, [visible]);

  useEffect(() => {
    const w = ws.current;
    if (!w) return;
    w.highlightBlock(highlight);
    if (highlight && w.getBlockById(highlight)) {
      w.centerOnBlock(highlight);
      (w.getBlockById(highlight) as Blockly.BlockSvg).select();
    }
  }, [highlight]);

  return <div ref={host} className="blockly-host" data-testid="block-editor" />;
}
