// -----------------------------------------------------------------------------
// A small, safe subset of Jinja2 — the template language of the Home Assistant
// MQTT discovery payloads (`value_template`, `command_template`...).
//
// Devices write the same few shapes over and over:
//   {{ value_json.temperature }}            {{ value_json['ENERGY']['Power'] }}
//   {{ value | float(0) | round(1) }}       {{ value_json.tempc | is_defined }}
//   {{ 'ON' if value_json.state else 'OFF' }}
//   {% if value_json.POWER == 'ON' %}on{% else %}off{% endif %}
// so this is an interpreter of that subset: expressions with Python semantics
// (truthiness, `//`, `%`, `in`, `is defined`), the common filters, a few
// string/dict methods, `{% if %}` and `{% set %}`. No code is ever compiled or
// evaluated: a template is tokenized, parsed into a tree, then walked.
//
// Undefined values follow Jinja's ChainableUndefined: reading a missing key
// gives Undefined, which renders as '' and can be chained or defaulted. A
// value template that renders nothing but Undefined is reported as `skipped`:
// the message was not meant for this entity (several entities share a topic).
// -----------------------------------------------------------------------------

export class TemplateError extends Error {}

/** Jinja's Undefined: a missing key, chainable, renders as ''. */
class Undefined {
  constructor(name) {
    this.name = name;
  }
}
const isUndef = (v) => v instanceof Undefined;

const MAX_TEMPLATE_LENGTH = 10_000;
const MAX_STEPS = 50_000;

// --- Tokenizer ---------------------------------------------------------------

const PUNCTUATION = [
  '**',
  '//',
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '~',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
  '|',
  ':',
  '=',
];

function tokenize(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(\d+\.\d*|\.\d+|\d+)(e[+-]?\d+)?/i.exec(source.slice(i));
      tokens.push({ type: 'num', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = '';
      while (j < source.length && source[j] !== c) {
        if (source[j] === '\\' && j + 1 < source.length) {
          const next = source[j + 1];
          text +=
            { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }[next] ?? `\\${next}`;
          j += 2;
        } else {
          text += source[j];
          j += 1;
        }
      }
      if (j >= source.length) {
        throw new TemplateError('unterminated string');
      }
      tokens.push({ type: 'str', value: text });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      tokens.push({ type: 'name', value: match[0] });
      i += match[0].length;
      continue;
    }
    const op = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (!op) {
      throw new TemplateError(`unexpected character "${c}"`);
    }
    tokens.push({ type: 'op', value: op });
    i += op.length;
  }
  tokens.push({ type: 'end' });
  return tokens;
}

// --- Expression parser -------------------------------------------------------

class Parser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  next() {
    return this.tokens[this.pos++];
  }

  isOp(value, offset = 0) {
    const t = this.peek(offset);
    return t.type === 'op' && t.value === value;
  }

  isName(value, offset = 0) {
    const t = this.peek(offset);
    return t.type === 'name' && t.value === value;
  }

  expectOp(value) {
    if (!this.isOp(value)) {
      throw new TemplateError(`expected "${value}"`);
    }
    this.next();
  }

  parseAll() {
    const node = this.parseExpression();
    if (this.peek().type !== 'end') {
      throw new TemplateError('unexpected token after the expression');
    }
    return node;
  }

  parseExpression() {
    let node = this.parseOr();
    if (this.isName('if')) {
      this.next();
      const test = this.parseOr();
      let otherwise = { kind: 'lit', value: new Undefined('else') };
      if (this.isName('else')) {
        this.next();
        otherwise = this.parseExpression();
      }
      node = { kind: 'cond', test, then: node, otherwise };
    }
    return node;
  }

  parseOr() {
    let node = this.parseAnd();
    while (this.isName('or')) {
      this.next();
      node = { kind: 'or', left: node, right: this.parseAnd() };
    }
    return node;
  }

  parseAnd() {
    let node = this.parseNot();
    while (this.isName('and')) {
      this.next();
      node = { kind: 'and', left: node, right: this.parseNot() };
    }
    return node;
  }

  parseNot() {
    if (this.isName('not')) {
      this.next();
      return { kind: 'not', operand: this.parseNot() };
    }
    return this.parseCompare();
  }

  parseCompare() {
    let node = this.parseConcat();
    for (;;) {
      const t = this.peek();
      if (t.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
        this.next();
        node = { kind: 'bin', op: t.value, left: node, right: this.parseConcat() };
      } else if (this.isName('in')) {
        this.next();
        node = { kind: 'in', negate: false, left: node, right: this.parseConcat() };
      } else if (this.isName('not') && this.isName('in', 1)) {
        this.next();
        this.next();
        node = { kind: 'in', negate: true, left: node, right: this.parseConcat() };
      } else if (this.isName('is')) {
        this.next();
        let negate = false;
        if (this.isName('not')) {
          this.next();
          negate = true;
        }
        const name = this.next();
        if (name.type !== 'name') {
          throw new TemplateError('expected a test name after "is"');
        }
        const args = [];
        if (this.isOp('(')) {
          args.push(...this.parseArgs().args);
        }
        node = { kind: 'test', name: name.value, negate, operand: node, args };
      } else {
        return node;
      }
    }
  }

  parseConcat() {
    let node = this.parseAdd();
    while (this.isOp('~')) {
      this.next();
      node = { kind: 'bin', op: '~', left: node, right: this.parseAdd() };
    }
    return node;
  }

  parseAdd() {
    let node = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().value;
      node = { kind: 'bin', op, left: node, right: this.parseMul() };
    }
    return node;
  }

  parseMul() {
    let node = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('//') || this.isOp('%')) {
      const op = this.next().value;
      node = { kind: 'bin', op, left: node, right: this.parseUnary() };
    }
    return node;
  }

  parseUnary() {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next().value;
      return { kind: 'unary', op, operand: this.parseUnary() };
    }
    return this.parsePow();
  }

  parsePow() {
    const node = this.parseFiltered();
    if (this.isOp('**')) {
      this.next();
      return { kind: 'bin', op: '**', left: node, right: this.parseUnary() };
    }
    return node;
  }

  parseFiltered() {
    let node = this.parsePostfix(this.parsePrimary());
    while (this.isOp('|')) {
      this.next();
      const name = this.next();
      if (name.type !== 'name') {
        throw new TemplateError('expected a filter name after "|"');
      }
      const call = this.isOp('(') ? this.parseArgs() : { args: [], kwargs: {} };
      node = { kind: 'filter', name: name.value, operand: node, ...call };
    }
    return node;
  }

  parsePostfix(node) {
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        const name = this.next();
        if (name.type !== 'name' && name.type !== 'num') {
          throw new TemplateError('expected an attribute name after "."');
        }
        node = { kind: 'attr', target: node, name: String(name.value) };
      } else if (this.isOp('[')) {
        this.next();
        const key = this.parseExpression();
        this.expectOp(']');
        node = { kind: 'item', target: node, key };
      } else if (this.isOp('(')) {
        node = { kind: 'call', target: node, ...this.parseArgs() };
      } else {
        return node;
      }
    }
  }

  parseArgs() {
    this.expectOp('(');
    const args = [];
    const kwargs = {};
    while (!this.isOp(')')) {
      if (this.peek().type === 'name' && this.isOp('=', 1)) {
        const key = this.next().value;
        this.next();
        kwargs[key] = this.parseExpression();
      } else {
        args.push(this.parseExpression());
      }
      if (!this.isOp(',')) {
        break;
      }
      this.next();
    }
    this.expectOp(')');
    return { args, kwargs };
  }

  parsePrimary() {
    const t = this.next();
    if (t.type === 'num' || t.type === 'str') {
      return { kind: 'lit', value: t.value };
    }
    if (t.type === 'name') {
      const constants = {
        true: true,
        false: false,
        none: null,
        True: true,
        False: false,
        None: null,
      };
      if (t.value in constants) {
        return { kind: 'lit', value: constants[t.value] };
      }
      return { kind: 'var', name: t.value };
    }
    if (t.type === 'op' && t.value === '(') {
      const node = this.parseExpression();
      this.expectOp(')');
      return node;
    }
    if (t.type === 'op' && t.value === '[') {
      const items = [];
      while (!this.isOp(']')) {
        items.push(this.parseExpression());
        if (!this.isOp(',')) {
          break;
        }
        this.next();
      }
      this.expectOp(']');
      return { kind: 'list', items };
    }
    if (t.type === 'op' && t.value === '{') {
      const entries = [];
      while (!this.isOp('}')) {
        const key = this.parseExpression();
        this.expectOp(':');
        entries.push([key, this.parseExpression()]);
        if (!this.isOp(',')) {
          break;
        }
        this.next();
      }
      this.expectOp('}');
      return { kind: 'dict', entries };
    }
    throw new TemplateError('unexpected end of expression');
  }
}

// --- Python-like values ------------------------------------------------------

const isMapping = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !isUndef(v);

function truthy(v) {
  if (isUndef(v) || v === null || v === undefined || v === false) {
    return false;
  }
  if (typeof v === 'number') {
    return v !== 0;
  }
  if (typeof v === 'string' || Array.isArray(v)) {
    return v.length > 0;
  }
  if (isMapping(v)) {
    return Object.keys(v).length > 0;
  }
  return true;
}

/** Python's str() of a value, as Jinja prints it. */
export function toText(v) {
  if (isUndef(v) || v === undefined) {
    return '';
  }
  if (v === null) {
    return 'None';
  }
  if (v === true) {
    return 'True';
  }
  if (v === false) {
    return 'False';
  }
  if (typeof v === 'number') {
    if (Number.isNaN(v)) {
      return 'nan';
    }
    if (!Number.isFinite(v)) {
      return v > 0 ? 'inf' : '-inf';
    }
    return String(v);
  }
  if (typeof v === 'string') {
    return v;
  }
  if (typeof v === 'function') {
    return '<function>';
  }
  return reprOf(v);
}

function reprOf(v) {
  if (typeof v === 'string') {
    return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  if (Array.isArray(v)) {
    return `[${v.map(reprOf).join(', ')}]`;
  }
  if (isMapping(v)) {
    return `{${Object.entries(v)
      .map(([k, x]) => `${reprOf(k)}: ${reprOf(x)}`)
      .join(', ')}}`;
  }
  return toText(v);
}

function equals(a, b) {
  if (isUndef(a) || isUndef(b)) {
    return isUndef(a) && isUndef(b);
  }
  if (typeof a === 'boolean' && typeof b === 'number') {
    return Number(a) === b;
  }
  if (typeof b === 'boolean' && typeof a === 'number') {
    return a === Number(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => equals(x, b[i]));
  }
  if (isMapping(a) && isMapping(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => equals(a[k], b[k]));
  }
  return a === b;
}

function requireDefined(v, what) {
  if (isUndef(v)) {
    throw new TemplateError(`${v.name} is undefined (${what})`);
  }
  return v;
}

function toFloat(v, fallback) {
  if (typeof v === 'number') {
    return v;
  }
  if (typeof v === 'boolean') {
    return Number(v);
  }
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) {
      return Number(s);
    }
    if (['nan', '+nan', '-nan'].includes(s)) {
      return Number.NaN;
    }
    if (['inf', '+inf', 'infinity', '+infinity'].includes(s)) {
      return Number.POSITIVE_INFINITY;
    }
    if (['-inf', '-infinity'].includes(s)) {
      return Number.NEGATIVE_INFINITY;
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TemplateError(`cannot convert ${reprOf(isUndef(v) ? '' : v)} to float`);
}

function toInt(v, fallback, base = 10) {
  if (typeof v === 'string' && base !== 10) {
    const parsed = Number.parseInt(v.trim(), base);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  } else {
    try {
      const f = toFloat(v);
      if (Number.isFinite(f)) {
        return Math.trunc(f);
      }
    } catch {
      // fall through to the fallback
    }
  }
  if (fallback !== undefined) {
    return fallback;
  }
  throw new TemplateError(`cannot convert ${reprOf(isUndef(v) ? '' : v)} to int`);
}

function arithmetic(op, a, b) {
  requireDefined(a, op);
  requireDefined(b, op);
  if (op === '+' && typeof a === 'string' && typeof b === 'string') {
    return a + b;
  }
  if (op === '+' && Array.isArray(a) && Array.isArray(b)) {
    return [...a, ...b];
  }
  if (op === '*' && typeof a === 'string' && Number.isInteger(b)) {
    return a.repeat(Math.max(0, b));
  }
  if (op === '%' && typeof a === 'string') {
    return printf(a, Array.isArray(b) ? b : [b]);
  }
  const x = typeof a === 'boolean' ? Number(a) : a;
  const y = typeof b === 'boolean' ? Number(b) : b;
  if (typeof x !== 'number' || typeof y !== 'number') {
    throw new TemplateError(`unsupported operand types for ${op}`);
  }
  switch (op) {
    case '+':
      return x + y;
    case '-':
      return x - y;
    case '*':
      return x * y;
    case '/':
      if (y === 0) {
        throw new TemplateError('division by zero');
      }
      return x / y;
    case '//':
      if (y === 0) {
        throw new TemplateError('division by zero');
      }
      return Math.floor(x / y);
    case '%':
      if (y === 0) {
        throw new TemplateError('modulo by zero');
      }
      return ((x % y) + y) % y;
    case '**':
      return x ** y;
    default:
      throw new TemplateError(`unknown operator ${op}`);
  }
}

function compare(op, a, b) {
  if (op === '==') {
    return equals(a, b);
  }
  if (op === '!=') {
    return !equals(a, b);
  }
  requireDefined(a, op);
  requireDefined(b, op);
  const x = typeof a === 'boolean' ? Number(a) : a;
  const y = typeof b === 'boolean' ? Number(b) : b;
  const comparable =
    (typeof x === 'number' && typeof y === 'number') ||
    (typeof x === 'string' && typeof y === 'string');
  if (!comparable) {
    throw new TemplateError(`"${op}" not supported between these types`);
  }
  switch (op) {
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '>':
      return x > y;
    default:
      return x >= y;
  }
}

function contains(container, item) {
  requireDefined(container, 'in');
  if (typeof container === 'string') {
    return container.includes(toText(item));
  }
  if (Array.isArray(container)) {
    return container.some((x) => equals(x, item));
  }
  if (isMapping(container)) {
    return Object.hasOwn(container, toText(item));
  }
  throw new TemplateError('"in" needs a string, a list or a mapping');
}

/** Python's printf-style formatting: %s %d %i %f %.Nf %x %X %e %%. */
function printf(format, args) {
  let index = 0;
  return format.replace(
    /%([-+ 0]*)(\d+)?(?:\.(\d+))?([sdifxXeEgG%])/g,
    (m, flags, width, precision, conv) => {
      if (conv === '%') {
        return '%';
      }
      const arg = args[index++];
      let text;
      switch (conv) {
        case 's':
          text = toText(arg);
          break;
        case 'd':
        case 'i':
          text = String(toInt(arg));
          break;
        case 'f':
          text = toFloat(arg).toFixed(precision === undefined ? 6 : Number(precision));
          break;
        case 'e':
        case 'E':
          text = toFloat(arg).toExponential(precision === undefined ? 6 : Number(precision));
          text = conv === 'E' ? text.toUpperCase() : text;
          break;
        case 'g':
        case 'G':
          text = String(
            Number(toFloat(arg).toPrecision(precision === undefined ? 6 : Number(precision) || 1)),
          );
          break;
        case 'x':
          text = toInt(arg).toString(16);
          break;
        default:
          text = toInt(arg).toString(16).toUpperCase();
      }
      if (flags.includes('+') && /^\d/.test(text)) {
        text = `+${text}`;
      }
      if (width && text.length < Number(width)) {
        const pad = flags.includes('0') && !flags.includes('-') ? '0' : ' ';
        if (flags.includes('-')) {
          text = text.padEnd(Number(width), ' ');
        } else if (pad === '0' && /^[+-]/.test(text)) {
          text = text[0] + text.slice(1).padStart(Number(width) - 1, '0');
        } else {
          text = text.padStart(Number(width), pad);
        }
      }
      return text;
    },
  );
}

/**
 * Python round(): on the exact binary value (round(2.675, 2) is 2.67, and
 * 50 * 2.55 is 127.49999999999999, so 127), half to even on exact ties.
 */
function pyRound(value, precision = 0) {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** precision;
  const scaled = value * factor;
  if (Number.isInteger(scaled * 2) && !Number.isInteger(scaled)) {
    const floor = Math.floor(scaled);
    return (floor % 2 === 0 ? floor : floor + 1) / factor;
  }
  return precision >= 0 && precision <= 100 ? Number(value.toFixed(precision)) : value;
}

// --- Filters, tests, functions, methods ---------------------------------------

const FILTERS = {
  float: (v, fallback) => toFloat(v, fallback),
  int: (v, fallback, base) => toInt(v, fallback, base === undefined ? 10 : toInt(base)),
  round: (v, precision = 0, method = 'common') => {
    const x = toFloat(v);
    const p = toInt(precision);
    if (method === 'floor') {
      return Math.floor(x * 10 ** p) / 10 ** p;
    }
    if (method === 'ceil') {
      return Math.ceil(x * 10 ** p) / 10 ** p;
    }
    return pyRound(x, p);
  },
  abs: (v) => Math.abs(toFloat(requireDefined(v, 'abs'))),
  default: (v, fallback = '', boolean = false) =>
    isUndef(v) || (boolean && !truthy(v)) ? fallback : v,
  lower: (v) => toText(v).toLowerCase(),
  upper: (v) => toText(v).toUpperCase(),
  capitalize: (v) => {
    const s = toText(v);
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  },
  title: (v) =>
    toText(v).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  string: (v) => toText(v),
  trim: (v, chars) => {
    const s = toText(v);
    if (chars === undefined) {
      return s.trim();
    }
    const set = new Set(toText(chars));
    let start = 0;
    let end = s.length;
    while (start < end && set.has(s[start])) start += 1;
    while (end > start && set.has(s[end - 1])) end -= 1;
    return s.slice(start, end);
  },
  replace: (v, from, to, count) => {
    const s = toText(v);
    const a = toText(from);
    const b = toText(to);
    if (count === undefined) {
      return a === '' ? s : s.split(a).join(b);
    }
    let out = s;
    for (let i = 0; i < toInt(count); i += 1) {
      out = out.replace(a, b);
    }
    return out;
  },
  length: (v) => {
    requireDefined(v, 'length');
    if (typeof v === 'string' || Array.isArray(v)) {
      return v.length;
    }
    if (isMapping(v)) {
      return Object.keys(v).length;
    }
    throw new TemplateError('length needs a string, a list or a mapping');
  },
  first: (v) =>
    Array.isArray(v) || typeof v === 'string'
      ? v.length
        ? v[0]
        : new Undefined('first')
      : new Undefined('first'),
  last: (v) =>
    Array.isArray(v) || typeof v === 'string'
      ? v.length
        ? v[v.length - 1]
        : new Undefined('last')
      : new Undefined('last'),
  join: (v, separator = '') =>
    Array.isArray(v) ? v.map(toText).join(toText(separator)) : toText(v),
  list: (v) =>
    Array.isArray(v) ? v : typeof v === 'string' ? [...v] : isMapping(v) ? Object.keys(v) : [v],
  min: (v) =>
    Array.isArray(v) && v.length
      ? v.reduce((a, b) => (compare('<', b, a) ? b : a))
      : new Undefined('min'),
  max: (v) =>
    Array.isArray(v) && v.length
      ? v.reduce((a, b) => (compare('>', b, a) ? b : a))
      : new Undefined('max'),
  sum: (v) => (Array.isArray(v) ? v.reduce((a, b) => arithmetic('+', a, b), 0) : toFloat(v)),
  bool: (v, fallback) => {
    if (typeof v === 'boolean') {
      return v;
    }
    const s = toText(v).trim().toLowerCase();
    if (['true', 'yes', 'on', 'enable', '1'].includes(s) || (typeof v === 'number' && v !== 0)) {
      return true;
    }
    if (['false', 'no', 'off', 'disable', '0', 'none', ''].includes(s) || v === 0) {
      return false;
    }
    if (fallback !== undefined) {
      return fallback;
    }
    throw new TemplateError(`cannot convert ${reprOf(s)} to a boolean`);
  },
  is_defined: (v) => {
    // Home Assistant: raise when the value is undefined, so the message is ignored.
    if (isUndef(v)) {
      throw new UndefinedSkip(v.name);
    }
    return v;
  },
  multiply: (v, factor, fallback) => {
    try {
      return toFloat(v) * toFloat(factor);
    } catch (err) {
      if (fallback !== undefined) {
        return fallback;
      }
      throw err;
    }
  },
  tojson: (v) => JSON.stringify(isUndef(v) ? null : v),
  to_json: (v) => JSON.stringify(isUndef(v) ? null : v),
  from_json: (v) => {
    try {
      return JSON.parse(toText(v));
    } catch {
      throw new TemplateError('from_json: invalid JSON');
    }
  },
  format: (v, ...args) => printf(toText(v), args),
  iif: (v, ifTrue = true, ifFalse = false, ifNone) =>
    (v === null || isUndef(v)) && ifNone !== undefined ? ifNone : truthy(v) ? ifTrue : ifFalse,
  regex_replace: (v, find = '', replace = '', ignorecase = false) =>
    toText(v).replace(
      safeRegex(toText(find), ignorecase ? 'gi' : 'g'),
      toText(replace).replace(/\\(\d)/g, '$$$1'),
    ),
  regex_match: (v, find = '', ignorecase = false) =>
    safeRegex(`^(?:${toText(find)})`, ignorecase ? 'i' : '').test(toText(v)),
  regex_search: (v, find = '', ignorecase = false) =>
    safeRegex(toText(find), ignorecase ? 'i' : '').test(toText(v)),
  timestamp_custom: (v, format = '%Y-%m-%d %H:%M:%S', local = true) =>
    strftime(toFloat(v), toText(format), truthy(local)),
  timestamp_local: (v) => strftime(toFloat(v), '%Y-%m-%dT%H:%M:%S', true),
  timestamp_utc: (v) => strftime(toFloat(v), '%Y-%m-%dT%H:%M:%S', false),
  ord: (v) => toText(v).codePointAt(0),
};
FILTERS.d = FILTERS.default;
FILTERS.count = FILTERS.length;
FILTERS.e = (v) => v;
FILTERS.safe = (v) => v;

/** The argument names of the filters, for the keyword form (`int(base=16)`). */
const FILTER_PARAMS = {
  float: ['default'],
  int: ['default', 'base'],
  round: ['precision', 'method'],
  default: ['default_value', 'boolean'],
  d: ['default_value', 'boolean'],
  trim: ['chars'],
  replace: ['old', 'new', 'count'],
  join: ['d'],
  bool: ['default'],
  multiply: ['amount', 'default'],
  iif: ['if_true', 'if_false', 'if_none'],
  regex_replace: ['find', 'replace', 'ignorecase'],
  regex_match: ['find', 'ignorecase'],
  regex_search: ['find', 'ignorecase'],
  timestamp_custom: ['format_string', 'local'],
};

/** A filter that skips the message when the value is undefined (`is_defined`). */
class UndefinedSkip extends Error {}

function safeRegex(pattern, flags) {
  if (pattern.length > 200) {
    throw new TemplateError('regular expression too long');
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    throw new TemplateError('invalid regular expression');
  }
}

function strftime(seconds, format, local) {
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) {
    throw new TemplateError('invalid timestamp');
  }
  const get = (localName, utcName) => (local ? d[localName]() : d[utcName]());
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const parts = {
    Y: get('getFullYear', 'getUTCFullYear'),
    m: pad(get('getMonth', 'getUTCMonth') + 1),
    d: pad(get('getDate', 'getUTCDate')),
    H: pad(get('getHours', 'getUTCHours')),
    M: pad(get('getMinutes', 'getUTCMinutes')),
    S: pad(get('getSeconds', 'getUTCSeconds')),
    '%': '%',
  };
  return format.replace(/%([YmdHMS%])/g, (m, k) => String(parts[k]));
}

const TESTS = {
  defined: (v) => !isUndef(v),
  undefined: (v) => isUndef(v),
  none: (v) => v === null,
  number: (v) => typeof v === 'number',
  integer: (v) => Number.isInteger(v),
  float: (v) => typeof v === 'number' && !Number.isInteger(v),
  string: (v) => typeof v === 'string',
  mapping: (v) => isMapping(v),
  iterable: (v) => typeof v === 'string' || Array.isArray(v) || isMapping(v),
  sequence: (v) => typeof v === 'string' || Array.isArray(v),
  boolean: (v) => typeof v === 'boolean',
  true: (v) => v === true,
  false: (v) => v === false,
  eq: (v, x) => equals(v, x),
  ne: (v, x) => !equals(v, x),
  in: (v, x) => contains(x, v),
  even: (v) => toInt(v) % 2 === 0,
  odd: (v) => toInt(v) % 2 !== 0,
  match: (v, find) => FILTERS.regex_match(v, find),
  search: (v, find) => FILTERS.regex_search(v, find),
};

const FUNCTIONS = {
  float: (v, fallback) => toFloat(v, fallback),
  int: (v, fallback) => toInt(v, fallback),
  bool: (v, fallback) => FILTERS.bool(v, fallback),
  round: (v, precision) => FILTERS.round(v, precision),
  min: (...args) => FILTERS.min(args.length === 1 ? args[0] : args),
  max: (...args) => FILTERS.max(args.length === 1 ? args[0] : args),
  iif: (...args) => FILTERS.iif(...args),
  is_number: (v) => {
    try {
      return Number.isFinite(toFloat(v));
    } catch {
      return false;
    }
  },
  range: (a, b, step = 1) => {
    const [start, end] = b === undefined ? [0, toInt(a)] : [toInt(a), toInt(b)];
    const out = [];
    for (let i = start; step > 0 ? i < end : i > end; i += step) {
      if (out.length > 10_000) {
        throw new TemplateError('range too large');
      }
      out.push(i);
    }
    return out;
  },
  dict: (...entries) => Object.fromEntries(entries),
};

function method(target, name) {
  if (typeof target === 'string') {
    const s = target;
    const methods = {
      lower: () => s.toLowerCase(),
      upper: () => s.toUpperCase(),
      strip: (chars) => FILTERS.trim(s, chars),
      lstrip: () => s.trimStart(),
      rstrip: () => s.trimEnd(),
      split: (sep, max) => {
        const parts =
          sep === undefined || sep === null
            ? s.trim().split(/\s+/).filter(Boolean)
            : s.split(toText(sep));
        if (max === undefined) {
          return parts;
        }
        const n = toInt(max);
        return n < 0 || parts.length <= n + 1
          ? parts
          : [...parts.slice(0, n), parts.slice(n).join(toText(sep))];
      },
      replace: (a, b, count) => FILTERS.replace(s, a, b, count),
      startswith: (prefix) => s.startsWith(toText(prefix)),
      endswith: (suffix) => s.endsWith(toText(suffix)),
      find: (sub) => s.indexOf(toText(sub)),
      isdigit: () => /^\d+$/.test(s),
      title: () => FILTERS.title(s),
      capitalize: () => FILTERS.capitalize(s),
      format: (...args) => {
        let i = 0;
        return s.replace(/\{(\d*)\}/g, (m, n) => toText(args[n === '' ? i++ : Number(n)]));
      },
    };
    return methods[name];
  }
  if (isMapping(target)) {
    const methods = {
      get: (key, fallback = null) =>
        Object.hasOwn(target, toText(key)) ? target[toText(key)] : fallback,
      keys: () => Object.keys(target),
      values: () => Object.values(target),
      items: () => Object.entries(target),
    };
    return methods[name];
  }
  if (Array.isArray(target)) {
    const methods = {
      index: (x) => target.findIndex((y) => equals(x, y)),
      count: (x) => target.filter((y) => equals(x, y)).length,
    };
    return methods[name];
  }
  return undefined;
}

// --- Evaluation --------------------------------------------------------------

function lookup(target, key, label) {
  if (isUndef(target)) {
    return new Undefined(label);
  }
  if (target === null || target === undefined) {
    return new Undefined(label);
  }
  if (Array.isArray(target) || typeof target === 'string') {
    if (typeof key === 'number' && Number.isInteger(key)) {
      const index = key < 0 ? target.length + key : key;
      return index >= 0 && index < target.length ? target[index] : new Undefined(label);
    }
  }
  if (isMapping(target)) {
    const k = toText(key);
    if (Object.hasOwn(target, k)) {
      return target[k];
    }
  }
  if (typeof key === 'string') {
    const bound = method(target, key);
    if (bound) {
      return bound;
    }
  }
  return new Undefined(label);
}

class Evaluator {
  constructor(vars) {
    this.vars = vars;
    this.steps = 0;
  }

  tick() {
    this.steps += 1;
    if (this.steps > MAX_STEPS) {
      throw new TemplateError('template too complex');
    }
  }

  args(nodes) {
    return nodes.map((n) => this.eval(n));
  }

  eval(node) {
    this.tick();
    switch (node.kind) {
      case 'lit':
        return node.value;
      case 'var':
        if (Object.hasOwn(this.vars, node.name)) {
          return this.vars[node.name];
        }
        if (Object.hasOwn(FUNCTIONS, node.name)) {
          return FUNCTIONS[node.name];
        }
        return new Undefined(node.name);
      case 'list':
        return node.items.map((n) => this.eval(n));
      case 'dict':
        return Object.fromEntries(
          node.entries.map(([k, v]) => [toText(this.eval(k)), this.eval(v)]),
        );
      case 'attr': {
        const target = this.eval(node.target);
        return lookup(target, node.name, `${isUndef(target) ? target.name : '?'}.${node.name}`);
      }
      case 'item': {
        const target = this.eval(node.target);
        const key = this.eval(node.key);
        return lookup(target, key, `${isUndef(target) ? target.name : '?'}[${reprOf(key)}]`);
      }
      case 'call': {
        const fn = this.eval(node.target);
        if (typeof fn !== 'function') {
          throw new TemplateError(
            isUndef(fn) ? `${fn.name} is not a known function` : 'not callable',
          );
        }
        const kwargs = Object.values(node.kwargs).map((n) => this.eval(n));
        return fn(...this.args(node.args), ...kwargs);
      }
      case 'filter': {
        const filter = FILTERS[node.name];
        if (!filter) {
          throw new TemplateError(`unknown filter "${node.name}"`);
        }
        const operand = this.eval(node.operand);
        const args = this.args(node.args);
        // Keyword arguments land at their position (int(base=16), round(precision=1)).
        const params = FILTER_PARAMS[node.name] ?? [];
        for (const [key, valueNode] of Object.entries(node.kwargs)) {
          const index = params.indexOf(key);
          if (index < 0) {
            throw new TemplateError(`filter "${node.name}" has no argument "${key}"`);
          }
          args[index] = this.eval(valueNode);
        }
        return filter(operand, ...args);
      }
      case 'test': {
        const test = TESTS[node.name];
        if (!test) {
          throw new TemplateError(`unknown test "${node.name}"`);
        }
        const result = test(this.eval(node.operand), ...this.args(node.args));
        return node.negate ? !result : result;
      }
      case 'not':
        return !truthy(this.eval(node.operand));
      case 'and': {
        const left = this.eval(node.left);
        return truthy(left) ? this.eval(node.right) : left;
      }
      case 'or': {
        const left = this.eval(node.left);
        return truthy(left) ? left : this.eval(node.right);
      }
      case 'cond':
        return truthy(this.eval(node.test)) ? this.eval(node.then) : this.eval(node.otherwise);
      case 'in': {
        const result = contains(this.eval(node.right), this.eval(node.left));
        return node.negate ? !result : result;
      }
      case 'unary': {
        const v = requireDefined(this.eval(node.operand), node.op);
        const n = typeof v === 'boolean' ? Number(v) : v;
        if (typeof n !== 'number') {
          throw new TemplateError(`bad operand for unary ${node.op}`);
        }
        return node.op === '-' ? -n : n;
      }
      case 'bin': {
        const left = this.eval(node.left);
        const right = this.eval(node.right);
        if (node.op === '~') {
          return toText(left) + toText(right);
        }
        if (['==', '!=', '<', '<=', '>', '>='].includes(node.op)) {
          return compare(node.op, left, right);
        }
        return arithmetic(node.op, left, right);
      }
      default:
        throw new TemplateError(`unknown node ${node.kind}`);
    }
  }
}

// --- Template (text + {{ }} + {% %}) ----------------------------------------

function splitTemplate(template) {
  const parts = [];
  const re = /(\{\{-?|\{%-?|\{#)([\s\S]*?)(-?\}\}|-?%\}|#\})/g;
  let last = 0;
  let match;
  while ((match = re.exec(template))) {
    const [whole, open, body, close] = match;
    let text = template.slice(last, match.index);
    if (open.endsWith('-') && text) {
      text = text.replace(/\s+$/, '');
    }
    if (text) {
      parts.push({ type: 'text', value: text });
    }
    if (open === '{{' || open === '{{-') {
      parts.push({ type: 'output', source: body });
    } else if (open.startsWith('{%')) {
      parts.push({ type: 'stmt', source: body.trim() });
    }
    last = match.index + whole.length;
    if (close.startsWith('-')) {
      const rest = /^\s*/.exec(template.slice(last));
      last += rest[0].length;
    }
  }
  const tail = template.slice(last);
  if (/\{\{|\{%/.test(tail)) {
    throw new TemplateError('unclosed {{ or {% tag');
  }
  if (tail) {
    parts.push({ type: 'text', value: tail });
  }
  return parts;
}

function buildTree(parts) {
  const root = { kind: 'block', children: [] };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  for (const part of parts) {
    if (part.type === 'text') {
      current().children.push({ kind: 'text', value: part.value });
      continue;
    }
    if (part.type === 'output') {
      current().children.push({ kind: 'output', expr: new Parser(part.source).parseAll() });
      continue;
    }
    const [keyword] = part.source.split(/\s+/, 1);
    const rest = part.source.slice(keyword.length).trim();
    if (keyword === 'if') {
      const node = {
        kind: 'if',
        branches: [{ test: new Parser(rest).parseAll(), body: [] }],
        otherwise: null,
      };
      current().children.push(node);
      stack.push({ kind: 'if-body', node, children: node.branches[0].body });
    } else if (keyword === 'elif' || keyword === 'else') {
      const frame = stack.pop();
      if (frame?.kind !== 'if-body') {
        throw new TemplateError(`unexpected {% ${keyword} %}`);
      }
      if (keyword === 'elif') {
        const branch = { test: new Parser(rest).parseAll(), body: [] };
        frame.node.branches.push(branch);
        stack.push({ kind: 'if-body', node: frame.node, children: branch.body });
      } else {
        frame.node.otherwise = [];
        stack.push({ kind: 'if-body', node: frame.node, children: frame.node.otherwise });
      }
    } else if (keyword === 'endif') {
      const frame = stack.pop();
      if (frame?.kind !== 'if-body') {
        throw new TemplateError('unexpected {% endif %}');
      }
    } else if (keyword === 'set') {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(rest);
      if (!match) {
        throw new TemplateError('invalid {% set %}');
      }
      current().children.push({
        kind: 'set',
        name: match[1],
        expr: new Parser(match[2]).parseAll(),
      });
    } else {
      throw new TemplateError(`unsupported statement {% ${keyword} %}`);
    }
  }
  if (stack.length !== 1) {
    throw new TemplateError('missing {% endif %}');
  }
  return root.children;
}

const compiled = new Map();
const MAX_CACHED = 2_000;

function compile(template) {
  if (typeof template !== 'string') {
    throw new TemplateError('a template must be a string');
  }
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new TemplateError('template too long');
  }
  let tree = compiled.get(template);
  if (!tree) {
    tree = buildTree(splitTemplate(template));
    if (compiled.size >= MAX_CACHED) {
      compiled.clear();
    }
    compiled.set(template, tree);
  }
  return tree;
}

function renderNodes(nodes, evaluator, out) {
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.text += node.value;
    } else if (node.kind === 'output') {
      const value = evaluator.eval(node.expr);
      if (isUndef(value)) {
        out.undefinedOutput = true;
      } else {
        out.definedOutput = true;
      }
      out.text += toText(value);
    } else if (node.kind === 'set') {
      evaluator.vars[node.name] = evaluator.eval(node.expr);
    } else if (node.kind === 'if') {
      const branch = node.branches.find((b) => truthy(evaluator.eval(b.test)));
      const body = branch ? branch.body : node.otherwise;
      if (body) {
        renderNodes(body, evaluator, out);
      }
    }
  }
}

/** Checks a template once, at discovery: throws a TemplateError when it cannot be parsed. */
export function checkTemplate(template) {
  compile(template);
}

/**
 * Renders a template with the given variables.
 * @returns {{ text: string, skipped: boolean }} `skipped` when the output is
 * only made of undefined values, or an `is_defined` filter hit one: the
 * message does not carry what this entity reads.
 */
export function render(template, vars = {}) {
  const tree = compile(template);
  const evaluator = new Evaluator({ ...vars });
  const out = { text: '', undefinedOutput: false, definedOutput: false };
  try {
    renderNodes(tree, evaluator, out);
  } catch (err) {
    if (err instanceof UndefinedSkip) {
      return { text: '', skipped: true };
    }
    if (err instanceof TemplateError) {
      throw err;
    }
    throw new TemplateError(err.message);
  }
  return {
    text: out.text,
    skipped: out.undefinedOutput && !out.definedOutput && out.text.trim() === '',
  };
}

/** The variables of a value template: `value` (the payload) and `value_json` when it is JSON. */
export function payloadVars(payload) {
  const value = typeof payload === 'string' ? payload : toText(payload);
  let valueJson = new Undefined('value_json');
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      valueJson = JSON.parse(trimmed);
    } catch {
      // not JSON: value_json stays undefined
    }
  } else if (/^-?\d+(\.\d+)?$/.test(trimmed) || ['true', 'false', 'null'].includes(trimmed)) {
    valueJson = JSON.parse(trimmed);
  }
  return { value, value_json: valueJson };
}
