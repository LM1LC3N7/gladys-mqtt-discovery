import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateError, checkTemplate, payloadVars, render } from '../src/template.js';

const run = (template, payload) => render(template, payloadVars(payload));
const text = (template, payload) => run(template, payload).text;

test('the value templates the devices actually publish', () => {
  // Tasmota (legacy discovery), nested keys with brackets.
  assert.equal(text("{{value_json['ENERGY']['Power']}}", '{"ENERGY":{"Power":42}}'), '42');
  assert.equal(text('{{value_json.POWER}}', '{"POWER":"ON"}'), 'ON');
  // Zigbee2MQTT / Shelly.
  assert.equal(text('{{ value_json.temperature }}', '{"temperature":21.37}'), '21.37');
  // ESPHome / plain payloads.
  assert.equal(text('{{ value | float | round(1) }}', '21.37'), '21.4');
  assert.equal(text('{{ (value | float / 1000) | round(2) }}', '1234'), '1.23');
  // Ternaries and comparisons.
  assert.equal(text("{{ 'ON' if value_json.state else 'OFF' }}", '{"state":true}'), 'ON');
  assert.equal(
    text("{{ 'ON' if value_json.state == 'open' else 'OFF' }}", '{"state":"closed"}'),
    'OFF',
  );
  // Blocks.
  assert.equal(
    text("{% if value_json.POWER == 'ON' %}on{% else %}off{% endif %}", '{"POWER":"ON"}'),
    'on',
  );
  assert.equal(
    text('{% if value | int > 10 %}high{% elif value | int > 5 %}mid{% else %}low{% endif %}', '7'),
    'mid',
  );
  // Python booleans and None print like Python.
  assert.equal(text('{{ value_json.a == 1 }}', '{"a":1}'), 'True');
  assert.equal(text('{{ value_json.a }}', '{"a":null}'), 'None');
  // String methods and filters.
  assert.equal(text("{{ value.split(',')[1] | trim }}", 'a, b ,c'), 'b');
  assert.equal(text('{{ value | lower }}', 'OPEN'), 'open');
  assert.equal(text("{{ '%.1f' | format(value | float) }}", '3.14159'), '3.1');
  assert.equal(text("{{ '%0.2f' % (value | float) }}", '2'), '2.00');
  assert.equal(text("{{ value_json.get('x', 5) }}", '{}'), '5');
  assert.equal(text('{{ value_json.list | length }}', '{"list":[1,2,3]}'), '3');
  assert.equal(text("{{ 'b' in value_json.list }}", '{"list":["a","b"]}'), 'True');
  assert.equal(text('{{ value | int(base=16) }}', 'ff'), '255');
  assert.equal(text('{{ value_json.v | multiply(0.1) | round(1) }}', '{"v":215}'), '21.5');
  assert.equal(text('{{ value_json.a ~ "-" ~ value_json.b }}', '{"a":1,"b":"x"}'), '1-x');
  assert.equal(text('{{ 7 // 2 }} {{ -7 % 3 }} {{ 2 ** 10 }}', ''), '3 2 1024');
  assert.equal(text('{{ value | float(0) }}', 'unavailable'), '0');
  assert.equal(text('{{ iif(value_json.on, "ON", "OFF") }}', '{"on":false}'), 'OFF');
});

test('undefined values: chainable, defaulted, or a skipped message', () => {
  // OpenMQTTGateway shares one topic between all the entities of a device.
  assert.deepEqual(run('{{ value_json.tempc | is_defined }}', '{"hum":55}'), {
    text: '',
    skipped: true,
  });
  assert.deepEqual(run('{{ value_json.tempc | is_defined }}', '{"tempc":21}'), {
    text: '21',
    skipped: false,
  });
  // A missing key renders nothing: the message is skipped.
  assert.equal(run('{{ value_json.missing.deeper }}', '{"a":1}').skipped, true);
  assert.equal(text('{{ value_json.missing | default("x") }}', '{}'), 'x');
  assert.equal(text('{{ value_json.a is defined }}', '{"a":0}'), 'True');
  assert.equal(text('{{ value_json.b is not defined }}', '{"a":0}'), 'True');
  // Not JSON: value_json is undefined, value is still there.
  assert.equal(text('{{ value_json.a | default(value) }}', 'raw'), 'raw');
});

test('errors are TemplateErrors, never crashes nor code execution', () => {
  assert.throws(() => run('{{ value | float }}', 'abc'), TemplateError);
  assert.throws(() => run('{{ value_json.a | unknown_filter }}', '{}'), TemplateError);
  assert.throws(() => checkTemplate('{% if x %}never closed'), TemplateError);
  assert.throws(() => checkTemplate('{{ 1 + }}'), TemplateError);
  assert.throws(() => run('{{ value.__proto__.constructor("return 1")() }}', 'x'), TemplateError);
  assert.throws(() => run('{{ 1 / 0 }}', ''), TemplateError);
  assert.throws(() => run('{{ range(100000000) | length }}', ''), TemplateError);
});

test('command templates render the value Gladys sends', () => {
  assert.equal(render('{"brightness": {{ value }}}', { value: 128 }).text, '{"brightness": 128}');
  assert.equal(render('{{ (value * 2.55) | round(0) | int }}', { value: 50 }).text, '127');
  assert.equal(render('{{ value | round(1) }}', { value: 2.25 }).text, '2.2');
});

test('payloadVars parses JSON payloads only', () => {
  assert.deepEqual(payloadVars('{"a":1}').value_json, { a: 1 });
  assert.equal(payloadVars('21.5').value_json, 21.5);
  assert.equal(payloadVars('ON').value, 'ON');
  assert.equal(text('{{ value_json is defined }}', 'ON'), 'False');
});
