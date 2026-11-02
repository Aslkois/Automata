// Headless compiler: Blockly JSON workspace state -> AutoScript.
// Each statement is prefixed with __at("<blockId>") so the decision inspector can point at
// the block that was executing when a trace entry was recorded.
import { BLOCK_DEFS, STANDARD_BLOCKS } from '../blockDefs';
import type { BlockJson, BlocksState, CompileResult } from '../types';
import { PRELUDE } from './prelude';

const KNOWN = new Set<string>([...STANDARD_BLOCKS, ...BLOCK_DEFS.map((b) => b.type as string)]);
const q = (s: unknown) => JSON.stringify(String(s));

class BlockCompiler {
  errors: CompileResult['errors'] = [];
  varNames = new Map<string, string>(); // variable id -> js name
  procNames = new Map<string, string>(); // procedure name -> js name
  inFailure = false;

  constructor(private state: BlocksState) {
    const used = new Set<string>();
    for (const v of state.variables ?? []) {
      let base = 'v_' + v.name.replace(/[^A-Za-z0-9_]/g, '_');
      while (used.has(base)) base += '_';
      used.add(base);
      this.varNames.set(v.id, base);
    }
  }

  varName(field: unknown): string {
    const id = typeof field === 'object' && field ? (field as { id?: string }).id : String(field);
    const n = id ? this.varNames.get(id) : undefined;
    if (!n) {
      this.errors.push({ message: `unknown variable ${JSON.stringify(field)}` });
      return 'undefined';
    }
    return n;
  }

  procName(name: string): string {
    let n = this.procNames.get(name);
    if (!n) {
      n = 'p_' + name.replace(/[^A-Za-z0-9_]/g, '_');
      this.procNames.set(name, n);
    }
    return n;
  }

  input(b: BlockJson, name: string): BlockJson | undefined {
    const i = b.inputs?.[name];
    return i?.block ?? i?.shadow;
  }

  expr(b: BlockJson | undefined, dflt: string): string {
    if (!b) return dflt;
    return `(${this.exprOf(b)})`;
  }

  field(b: BlockJson, name: string): string {
    const f = b.fields?.[name];
    return f === undefined || f === null ? '' : String(f);
  }

  /** Statement chain starting at block b. */
  stmts(b: BlockJson | undefined, indent: string): string {
    let out = '';
    let cur = b;
    let guard = 0;
    while (cur && guard++ < 10000) {
      out += this.stmt(cur, indent);
      cur = cur.next?.block;
    }
    return out;
  }

  stmt(b: BlockJson, ind: string): string {
    if (!KNOWN.has(b.type)) {
      this.errors.push({ message: `unsupported block '${b.type}'`, ref: b.id });
      return '';
    }
    const at = `${ind}__at(${q(b.id)});\n`;
    const body = (name: string) => this.stmts(this.input(b, name), ind + '  ');
    const W = () => q(this.field(b, 'WEAPON'));
    switch (b.type) {
      case 'controls_if': {
        const n = Number((b.extraState?.elseIfCount as number) ?? 0);
        let s = `${at}${ind}if ${this.expr(this.input(b, 'IF0'), 'false')} {\n${body('DO0')}${ind}}`;
        for (let i = 1; i <= n; i++) s += ` else if ${this.expr(this.input(b, 'IF' + i), 'false')} {\n${body('DO' + i)}${ind}}`;
        if (b.extraState?.hasElse) s += ` else {\n${body('ELSE')}${ind}}`;
        return s + '\n';
      }
      case 'controls_repeat_ext':
        return `${at}${ind}for (var __i_${safeId(b.id)} = 0; __i_${safeId(b.id)} < ${this.expr(this.input(b, 'TIMES'), '0')}; __i_${safeId(b.id)}++) {\n${body('DO')}${ind}}\n`;
      case 'controls_whileUntil': {
        const c = this.expr(this.input(b, 'BOOL'), 'false');
        return `${at}${ind}while (${this.field(b, 'MODE') === 'UNTIL' ? '!' : ''}${c}) {\n${body('DO')}${ind}}\n`;
      }
      case 'controls_for': {
        const v = this.varName(b.fields?.VAR);
        const by = this.expr(this.input(b, 'BY'), '1');
        return `${at}${ind}for (${v} = ${this.expr(this.input(b, 'FROM'), '0')}; (${by}) >= 0 ? ${v} <= ${this.expr(this.input(b, 'TO'), '0')} : ${v} >= ${this.expr(this.input(b, 'TO'), '0')}; ${v} += ${by}) {\n${body('DO')}${ind}}\n`;
      }
      case 'controls_forEach': {
        const v = this.varName(b.fields?.VAR);
        return `${at}${ind}for (${v} of (${this.expr(this.input(b, 'LIST'), '[]')} || [])) {\n${body('DO')}${ind}}\n`;
      }
      case 'controls_flow_statements':
        return `${at}${ind}${this.field(b, 'FLOW') === 'CONTINUE' ? 'continue' : 'break'};\n`;
      case 'variables_set':
        return `${at}${ind}${this.varName(b.fields?.VAR)} = ${this.expr(this.input(b, 'VALUE'), 'null')};\n`;
      case 'math_change': {
        const v = this.varName(b.fields?.VAR);
        return `${at}${ind}${v} = (typeof ${v} === 'number' ? ${v} : 0) + ${this.expr(this.input(b, 'DELTA'), '1')};\n`;
      }
      case 'procedures_callnoreturn':
        return `${at}${ind}${this.callProc(b)};\n`;
      case 'procedures_ifreturn': {
        const v = b.extraState?.hasReturnValue === false ? '' : ' ' + this.expr(this.input(b, 'VALUE'), 'null');
        return `${at}${ind}if ${this.expr(this.input(b, 'CONDITION'), 'false')} { return${v}; }\n`;
      }
      case 'drone_drive':
        return `${at}${ind}drone.drive(${this.expr(this.input(b, 'THROTTLE'), '0')}, ${this.expr(this.input(b, 'STEER'), '0')});\n`;
      case 'drone_stop':
        return `${at}${ind}drone.stop();\n`;
      case 'drone_turn_toward_contact':
        return `${at}${ind}__turnTowardContact(${this.expr(this.input(b, 'CONTACT'), 'null')}, ${this.expr(this.input(b, 'THROTTLE'), '1')});\n`;
      case 'drone_turn_toward':
        return `${at}${ind}drone.turnToward(${this.expr(this.input(b, 'X'), '0')}, ${this.expr(this.input(b, 'Y'), '0')}, ${this.expr(this.input(b, 'THROTTLE'), '1')});\n`;
      case 'drone_aim_at_contact':
        return `${at}${ind}__aimAtContact(${W()}, ${this.expr(this.input(b, 'CONTACT'), 'null')}, ${b.fields?.LEAD === false || b.fields?.LEAD === 'FALSE' ? 'false' : 'true'});\n`;
      case 'drone_aim_angle':
        return `${at}${ind}drone.aim(${W()}, ${this.expr(this.input(b, 'ANGLE'), '0')});\n`;
      case 'drone_fire':
        return `${at}${ind}drone.fire(${W()}, ${this.field(b, 'ON') === 'FALSE' ? 'false' : 'true'});\n`;
      case 'drone_fire_if':
        return `${at}${ind}drone.fire(${W()}, !!${this.expr(this.input(b, 'COND'), 'false')});\n`;
      case 'drone_reload':
        return `${at}${ind}drone.reload(${W()});\n`;
      case 'drone_engage_all':
        return `${at}${ind}__engageAll(${this.expr(this.input(b, 'CONTACT'), 'null')});\n`;
      case 'drone_shield_face_contact':
        return `${at}${ind}__shieldFaceContact(${q(this.field(b, 'SHIELD'))}, ${this.expr(this.input(b, 'CONTACT'), 'null')});\n`;
      case 'drone_shield_raise':
        return `${at}${ind}drone.raiseShield(${q(this.field(b, 'SHIELD'))}, ${this.field(b, 'ON') === 'FALSE' ? 'false' : 'true'});\n`;
      case 'drone_set_power':
        return `${at}${ind}drone.setPower(${this.expr(this.input(b, 'P'), '1')}, ${this.expr(this.input(b, 'W'), '1')}, ${this.expr(this.input(b, 'S'), '1')});\n`;
      case 'drone_reset_timer':
        return `${at}${ind}drone.resetTimer(${q(this.field(b, 'NAME'))});\n`;
      case 'drone_log':
        return `${at}${ind}drone.log(${this.expr(this.input(b, 'VALUE'), "''")});\n`;
      default:
        if (isValueBlock(b.type)) {
          // A value block used as a statement: evaluate for side effects.
          return `${at}${ind}${this.exprOf(b)};\n`;
        }
        this.errors.push({ message: `block '${b.type}' cannot be used as a statement`, ref: b.id });
        return '';
    }
  }

  callProc(b: BlockJson): string {
    const name = String(b.extraState?.name ?? this.field(b, 'NAME'));
    const params = (b.extraState?.params as string[] | undefined) ?? [];
    const args = params.map((_, i) => this.expr(this.input(b, 'ARG' + i), 'null'));
    return `${this.procName(name)}(${args.join(', ')})`;
  }

  exprOf(b: BlockJson): string {
    if (!KNOWN.has(b.type)) {
      this.errors.push({ message: `unsupported block '${b.type}'`, ref: b.id });
      return 'null';
    }
    const f = (n: string) => this.field(b, n);
    const i = (n: string, d: string) => this.expr(this.input(b, n), d);
    switch (b.type) {
      case 'math_number': {
        const n = Number(b.fields?.NUM ?? 0);
        return Number.isFinite(n) ? String(n) : '0';
      }
      case 'text':
        return q(f('TEXT'));
      case 'logic_boolean':
        return f('BOOL') === 'TRUE' ? 'true' : 'false';
      case 'logic_null':
        return 'null';
      case 'logic_compare': {
        const ops: Record<string, string> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
        return `${i('A', '0')} ${ops[f('OP')] ?? '=='} ${i('B', '0')}`;
      }
      case 'logic_operation':
        return `${i('A', 'false')} ${f('OP') === 'OR' ? '||' : '&&'} ${i('B', 'false')}`;
      case 'logic_negate':
        return `!${i('BOOL', 'false')}`;
      case 'logic_ternary':
        return `${i('IF', 'false')} ? ${i('THEN', 'null')} : ${i('ELSE', 'null')}`;
      case 'math_arithmetic': {
        const ops: Record<string, string> = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/', POWER: '**' };
        return `${i('A', '0')} ${ops[f('OP')] ?? '+'} ${i('B', '0')}`;
      }
      case 'math_single': {
        const x = i('NUM', '0');
        const m: Record<string, string> = { ROOT: `Math.sqrt(${x})`, ABS: `Math.abs(${x})`, NEG: `-${x}`, LN: `Math.log(${x})`, LOG10: `Math.log10(${x})`, EXP: `Math.exp(${x})`, POW10: `Math.pow(10, ${x})` };
        return m[f('OP')] ?? x;
      }
      case 'math_trig': {
        const x = i('NUM', '0');
        const m: Record<string, string> = {
          SIN: `Math.sin(${x} / 180 * Math.PI)`,
          COS: `Math.cos(${x} / 180 * Math.PI)`,
          TAN: `Math.tan(${x} / 180 * Math.PI)`,
          ASIN: `Math.asin(${x}) / Math.PI * 180`,
          ACOS: `Math.acos(${x}) / Math.PI * 180`,
          ATAN: `Math.atan(${x}) / Math.PI * 180`,
        };
        return m[f('OP')] ?? x;
      }
      case 'math_round': {
        const m: Record<string, string> = { ROUND: 'Math.round', ROUNDUP: 'Math.ceil', ROUNDDOWN: 'Math.floor' };
        return `${m[f('OP')] ?? 'Math.round'}(${i('NUM', '0')})`;
      }
      case 'math_modulo':
        return `${i('DIVIDEND', '0')} % ${i('DIVISOR', '1')}`;
      case 'math_constrain':
        return `Math.min(Math.max(${i('VALUE', '0')}, ${i('LOW', '0')}), ${i('HIGH', '0')})`;
      case 'math_random_float':
        return 'Math.random()';
      case 'text_join': {
        const n = Number((b.extraState?.itemCount as number) ?? 2);
        const parts = [];
        for (let k = 0; k < n; k++) parts.push(`String(${i('ADD' + k, "''")})`);
        return parts.length ? parts.join(' + ') : "''";
      }
      case 'lists_create_with': {
        const n = Number((b.extraState?.itemCount as number) ?? 0);
        const parts = [];
        for (let k = 0; k < n; k++) parts.push(i('ADD' + k, 'null'));
        return `[${parts.join(', ')}]`;
      }
      case 'lists_length':
        return `(${i('VALUE', '[]')} || []).length`;
      case 'list_item':
        return `__listItem(${i('LIST', '[]')}, ${i('INDEX', '1')})`;
      case 'variables_get':
        return this.varName(b.fields?.VAR);
      case 'procedures_callreturn':
        return this.callProc(b);
      case 'drone_failure_prop':
        if (!this.inFailure) {
          this.errors.push({ message: '"failure" value can only be used inside "when hardware fails"', ref: b.id });
          return 'null';
        }
        return `event.${f('PROP') || 'type'}`;
      case 'drone_nearest_enemy':
        return 'drone.nearestEnemy()';
      case 'drone_enemy_count':
        return 'drone.enemies().length';
      case 'drone_threat_count':
        return 'drone.threats().length';
      case 'drone_contact_exists':
        return `${i('CONTACT', 'null')} != null`;
      case 'drone_contact_prop':
        return `(${i('CONTACT', 'null')})?.${/^[a-z]+$/.test(f('PROP')) ? f('PROP') : 'x'} ?? 0`;
      case 'drone_self': {
        const p = f('PROP');
        return `drone.${['x', 'y', 'heading', 'speed', 'time'].includes(p) ? p : 'x'}()`;
      }
      case 'drone_angle_to':
        return `drone.angleTo(${i('X', '0')}, ${i('Y', '0')})`;
      case 'drone_distance_to':
        return `drone.distanceTo(${i('X', '0')}, ${i('Y', '0')})`;
      case 'drone_angle_diff':
        return `angleDiff(${i('A', '0')}, ${i('B', '0')})`;
      case 'drone_weapon_prop':
        return `drone.weapon(${q(f('WEAPON'))}).${/^[a-z]+$/.test(f('PROP')) ? f('PROP') : 'ready'}`;
      case 'drone_can_fire':
        return `__canFire(${q(f('WEAPON'))}, ${i('CONTACT', 'null')})`;
      case 'drone_component_ok':
        return `drone.component(${q(f('ID'))}).functional`;
      case 'drone_count_kind':
        return `drone.count(${q(f('KIND'))})`;
      case 'drone_status_flag':
        return `drone.status().${/^[a-z]+$/.test(f('FLAG')) ? f('FLAG') : 'degraded'}`;
      case 'drone_power_prop':
        return `drone.power().${/^[a-z]+$/.test(f('PROP')) ? f('PROP') : 'stored'}`;
      case 'drone_shield_charge':
        return `(drone.shields().find(function (s) { return s.id == ${q(f('SHIELD'))}; }) || { charge: 0 }).charge`;
      case 'drone_elapsed':
        return `drone.elapsed(${q(f('NAME'))})`;
      default:
        this.errors.push({ message: `block '${b.type}' does not produce a value`, ref: b.id });
        return 'null';
    }
  }

  compile(): CompileResult {
    const top = this.state.blocks?.blocks ?? [];
    const sorted = [...top].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    let decls = '';
    const vars = [...this.varNames.values()];
    if (vars.length) decls += `var ${vars.join(', ')};\n`;
    let procs = '';
    let start = '';
    let update = '';
    let failure = '';
    let ignored = 0;
    for (const b of sorted) {
      switch (b.type) {
        case 'procedures_defnoreturn':
        case 'procedures_defreturn': {
          const name = this.procName(this.field(b, 'NAME'));
          const params = ((b.extraState?.params as { name: string; id: string }[] | undefined) ?? []).map((p) => this.varNames.get(p.id) ?? 'v_' + p.name.replace(/[^A-Za-z0-9_]/g, '_'));
          // Blockly procedure parameters are workspace variables; bind them as globals for the call.
          const saved = params.map((p, k) => `var __s${k} = ${p}; ${p} = arguments_${k};`).join(' ');
          const restore = params.map((p, k) => `${p} = __s${k};`).join(' ');
          const ret = b.type === 'procedures_defreturn' ? this.expr(this.input(b, 'RETURN'), 'null') : 'undefined';
          procs += `function ${name}(${params.map((_, k) => 'arguments_' + k).join(', ')}) {\n  ${saved}\n  var __r = (function () {\n${this.stmts(this.input(b, 'STACK'), '    ')}    return ${ret};\n  })();\n  ${restore}\n  return __r;\n}\n`;
          break;
        }
        case 'event_start':
          start += this.stmts(this.input(b, 'DO'), '');
          break;
        case 'event_update':
          update += this.stmts(this.input(b, 'DO'), '  ');
          break;
        case 'event_failure':
          this.inFailure = true;
          failure += this.stmts(this.input(b, 'DO'), '  ');
          this.inFailure = false;
          break;
        default:
          ignored++;
      }
    }
    let js = PRELUDE + decls + procs + start;
    if (update) js += `function update() {\n${update}}\n`;
    if (failure) js += `function onFailure(event) {\n${failure}}\n`;
    if (!update && !failure && !start) this.errors.push({ message: 'program has no event blocks ("every decision tick", "when program starts" or "when hardware fails")' });
    void ignored;
    return { ok: this.errors.length === 0, js, errors: this.errors, locMode: 'marker', markerKind: 'block' };
  }
}

const safeId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');

const VALUE_TYPES = new Set(
  BLOCK_DEFS.filter((b) => 'output' in b).map((b) => b.type as string),
);
function isValueBlock(t: string): boolean {
  return VALUE_TYPES.has(t) || t.startsWith('math_') || t.startsWith('logic_') || t === 'text' || t === 'procedures_callreturn' || t === 'variables_get';
}

export function compileBlocks(state: BlocksState): CompileResult {
  try {
    return new BlockCompiler(state ?? {}).compile();
  } catch (e) {
    return { ok: false, js: '', errors: [{ message: `block compiler error: ${(e as Error).message}` }], locMode: 'marker', markerKind: 'block' };
  }
}
