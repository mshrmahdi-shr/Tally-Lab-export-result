const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function app(){
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://tally.test',pretendToBeVisual:true});
  const w=dom.window, downloads=[];
  w.pdfjsLib={GlobalWorkerOptions:{}};
  w.alert=message=>{throw Error(message)};
  w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).name=this.download;};
  for(const name of ['native-dxf-base.js','magic-native-table.js'])w.eval(fs.readFileSync(path.join(root,name),'utf8'));
  w.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  return {w,dom,downloads};
}
function certificate(matrix,job){
  return `Project Name: Integration Test\nProject ID: TEST\nDate Sampled: 16-Sep-2026\nTable 9\n26-${job}-1 26-${job}-2\nBH101 BH102\n1.00-2.00m 2.00-3.00m\nVOCs in ${matrix}\nVinyl Chloride 0.1 294 0.5\nMetals in ${matrix}\nArsenic 2 20 10`;
}
async function load(w,matrix,job){
  await w.addCertificateFiles([{name:matrix+'.txt',type:'text/plain',text:async()=>certificate(matrix,job)}]);
}
function blobText(w,blob){return new Promise((resolve,reject)=>{const r=new w.FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsText(blob);});}

test('read lab results → report and borehole DXF downloads; soil and water stay separate',async()=>{
  const {w,downloads}=app();
  try{
    await load(w,'Soil',9000);await load(w,'Water',9001);
    w.document.getElementById('runBtn').click();
    const buttons=[...w.document.querySelectorAll('.report-head [data-dxf-export]')];
    assert.equal(buttons.length,2);
    assert.notEqual(buttons[0].dataset.dxfExport,buttons[1].dataset.dxfExport);
    for(const [i,button] of buttons.entries()){
      button.click();
      const file=downloads.at(-1), text=await blobText(w,file.blob);
      assert.match(file.name,/\.dxf$/);
      assert.equal(file.blob.type,'application/dxf;charset=us-ascii');
      assert.match(text,new RegExp('26-'+(i?9001:9000)+'-1'));
      assert.doesNotMatch(text,new RegExp('26-'+(i?9000:9001)+'-1'));
      assert.equal((text.match(/\n100\nAcDbTable\n/g)||[]).length,2);
      assert.match(text,/<Table 9 SCS/);
      assert.match(text,/Vinyl Chloride/);
      assert.match(text,/294/);
      assert.equal(button.disabled,false);
    }
    const single=w.document.querySelector('.bh-row [data-dxf-export]');
    single.click();
    const text=await blobText(w,downloads.at(-1).blob);
    assert.equal((text.match(/\n100\nAcDbTable\n/g)||[]).length,1);
    assert.match(w.document.getElementById('nativeDxfStatus').textContent,/1 editable/);
  }finally{w.close();}
});

test('current analysis filter and renamed boreholes reach DXF',async()=>{
  const {w,downloads}=app();
  try{
    await load(w,'Soil',9000);
    w.document.getElementById('runBtn').click();
    const metal=[...w.document.querySelectorAll('#catChecks input')].find(x=>x.dataset.catKey==='Metals');
    assert.ok(metal);metal.checked=false;metal.dispatchEvent(new w.Event('change',{bubbles:true}));
    w.document.getElementById('runBtn').click();
    w.prompt=()=> 'BH_RENAMED';
    w.document.querySelector('[data-rename-bh]').click();
    w.document.querySelector('.report-head [data-dxf-export]').click();
    const text=await blobText(w,downloads.at(-1).blob);
    assert.match(text,/BH_RENAMED/);
    assert.match(text,/Vinyl Chloride/);
    assert.doesNotMatch(text,/Arsenic/);
  }finally{w.close();}
});

test('site-plan results and optional CSV use the same native writer',async()=>{
  const {w,downloads}=app();
  try{
    const samples={'26-9000-1':{bh:'BH101',date:'16 September 2026',depth:'',categories:{VOC:true},exceed:{},isDup:false}};
    const el=w.buildSitePlanReportEl('Soil — Test',samples,'ppm',null);
    assert.ok(el);w.document.getElementById('reportWrap').appendChild(el);w.ensureCopyHandler();
    el.querySelector('[data-dxf-export]').click();
    assert.equal(downloads.length,1);
    const text=await blobText(w,downloads[0].blob);
    assert.match(text,/\n100\nAcDbTable\n/);
    const csv='BH,Date,SampleID,Depth,Analyses,ExceededGroups,ComplianceText\nBH101,,S1,,VOC,,<Table 9 SCS';
    await w.magicCsvDxfLoadFile({name:'synthetic.csv',text:async()=>csv});
    const button=w.document.getElementById('magicCsvDxfExportBtn');assert.equal(button.disabled,false);button.click();
    assert.equal(downloads.length,2);
    assert.match(await blobText(w,downloads[1].blob),/<Table 9 SCS/);
    await w.magicCsvDxfLoadFile({name:'bad.csv',text:async()=> 'invalid'});
    assert.equal(button.disabled,true);
  }finally{w.close();}
});
