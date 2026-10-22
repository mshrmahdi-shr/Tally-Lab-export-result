const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const start = html.indexOf('const MAGIC_CSV_DXF_SUMMARY_HEADERS');
const end = html.indexOf('function magicCsvDxfEscapeHtml', start);
const ctx = vm.createContext({});
vm.runInContext(html.slice(start, end), ctx);
const resolve = text => ctx.magicCsvDxfResolveTables(ctx.magicCsvDxfRowsFromText(text));
const header = 'BH,Date,SampleID,Depth,Analyses,ExceededGroup,Parameter,ResultValue,StandardValue,ComplianceText\n';
const fixture = header + [
  'BH-01,2026-09-16,S-01,,VOC,,,,,<Table 9 SCS',
  'BH-02,2026-09-16,S-02,1-2 m,VOC,VOC,Compound A,184,1.6,',
  'BH-02,2026-09-16,S-02,1-2 m,VOC,VOC,,294,0.5,',
  'BH-02,2026-09-17,S-02 (Field Duplicate),1-2 m,VOC,,,,,<Table 9 SCS'
].join('\n');

test('compliant samples retain compliance text without spurious detail rows', () => {
  const models = resolve(fixture);
  assert.equal(models.length, 3);
  assert.equal(models[0].rows.length, 1);
  assert.equal(models[0].rows[0].exceededGroups, '<Table 9 SCS');
  assert.equal(models[0].rows[0].depth, '');
  assert.equal(models[2].rows[0].note, '(Field Duplicate)');
});
test('detail columns retain positional alignment for missing parameter names', () => {
  const row = resolve(fixture)[1].rows[1];
  assert.deepEqual(Array.from(row.parameters), ['Compound A', '']);
  assert.deepEqual(Array.from(row.results), ['184', '294']);
});
test('native DXF has editable tables with merged cells and graphics caches', () => {
  const api = require('../magic-native-table.js');
  const models = resolve(fixture);
  const tables = api.layout(models);
  assert.equal(tables[0].grid.length, 2);
  assert.equal(tables[0].grid[0][0].cs, 4);
  assert.equal(tables[0].grid[1][2].cs, 2);
  assert.equal(tables[1].grid[1][0].rs, 2);
  const dxf = api.build(models);
  assert.match(dxf, /AC1018/);
  assert.equal((dxf.match(/\nACAD_TABLE\n/g)||[]).length, 4); // class + 3 entities
  assert.equal((dxf.match(/\n100\nAcDbTable\n/g)||[]).length, 3);
  assert.match(dxf, /<Table 9 SCS/);
  assert.match(dxf, /\nTABLESTYLE\n/);
  assert.ok(!dxf.includes('undefined'));
});
test('user text cannot inject MTEXT formatting or DXF entities', () => {
  const api = require('../magic-native-table.js');
  const text = api.escapeText('A{B}\\C1;\n0\nLINE\nگمانه');
  assert.ok(text.includes('A\\{B\\}\\\\C1;'));
  assert.ok(!text.includes('\n'));
  const dxf = api.build([{bh:'گمانه', date:'', mode:'summary', rows:[{sample:'S', depth:'', analyses:'A{B}\\C1;', result:'Unknown', exceeded:false}]}]);
  assert.match(dxf, /\\U\+[0-9A-F]{4}/);
  assert.ok(!/[^\x00-\x7f]/.test(dxf));
});
test('empty exports are rejected', () => {
  const api = require('../magic-native-table.js');
  assert.throws(() => api.build([]), /No tables/);
});
module.exports = {fixture, resolve};

test('large projects and long Unicode cell content export without truncation',()=>{
  const api=require('../magic-native-table.js');
  const models=Array.from({length:120},(_,i)=>({bh:'BH'+i,date:'2026-09-16',mode:'summary',rows:[{sample:'S'+i,analyses:'A'.repeat(600)+' فارسی',result:'Unknown',exceeded:false}]}));
  const dxf=api.build(models);
  assert.equal((dxf.match(/\n100\nAcDbTable\n/g)||[]).length,120);
  assert.ok(dxf.endsWith('0\nEOF\n'));
  assert.ok(!dxf.includes('undefined'));
});
