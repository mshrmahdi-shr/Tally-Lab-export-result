/* Native R2004 ACAD_TABLE writer. No AutoLISP, CAD executable or network required. */
(function(root){
'use strict';
const base = typeof module !== 'undefined' && module.exports ? require('./native-dxf-base.js') : root.TallyDxfBase;
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const escapeText=value=>String(value??'').replace(/\\/g,'\\\\').replace(/\{/g,'\\{').replace(/\}/g,'\\}').replace(/\r\n|\r|\n/g,'\\P').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');
const rich=(text,color=0,bold=false,underline=false)=>text===''?'':'{\\fArial|b'+Number(bold)+'|i0;'+(color?'\\C'+color+';':'\\c0;')+(underline?'\\L':'')+escapeText(text)+(underline?'\\l':'')+'}';
function fullDate(value,enabled){
  const s=String(value||'');
  if(!enabled || !/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const d=new Date(s+'T00:00:00Z');
  if(Number.isNaN(d.valueOf()) || d.toISOString().slice(0,10)!==s)return s;
  return d.getUTCDate()+' '+['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]+' '+d.getUTCFullYear();
}
function layout(models,options={}){
  if(!Array.isArray(models)||!models.length)throw Error('No tables to export. Read laboratory results first.');
  const rows=models.flatMap(m=>m.rows||[]);
  if(!rows.length)throw Error('No tables to export.');
  const max=(values,min)=>values.reduce((n,v)=>Math.max(n,String(v??'').length),min);
  const sampleN=max(rows.map(r=>r.sample),8)+Math.min(12,max(rows.map(r=>r.depth),0));
  const analysisN=max(rows.map(r=>r.analyses),8);
  const paramN=max(rows.flatMap(r=>[r.group,...(r.parameters||[])]),10);
  const numberN=max(rows.flatMap(r=>[...(r.results||[]),...(r.standards||[])]),7);
  const widths=options.referenceLayout===false?[36,68,24,24]:[clamp(22.95+.2295*sampleN,26.01,30.6),clamp(42+.5*paramN,54,64),clamp(12+.3*numberN,15,19),clamp(12+.3*numberN,15,19)];
  const font=(w,n,lo,hi)=>clamp(w*.88/(.62*n),lo,hi);
  const sf=font(widths[0],sampleN,2.35,2.7), af=font(widths[1],analysisN,2.25,2.6), pf=font(widths[1],paramN,2.2,2.55), nf=font(widths[3],numberN,2.2,2.5);
  const rh=clamp(Math.max(sf,af,pf,nf)*4.165,11.05,13.855);
  const cell=(text='',size=pf,rs=1,cs=1,hidden=false)=>({text,size,rs,cs,hidden});
  const hidden=()=>cell('',pf,1,1,true);
  const columnY=[0,0,0,0], totalWidth=widths.reduce((a,b)=>a+b,0);
  return models.map((m,i)=>{
    const date=fullDate(m.date,options.fullDate!==false), title=String(m.bh||'Borehole')+(date?' ('+date+')':'');
    const tf=font(totalWidth,Math.max(14,title.length),2.45,2.8);
    const grid=[[cell(rich(title,0,true),tf,1,4),hidden(),hidden(),hidden()]], heights=[clamp(tf*2.35,6.2,7.2)];
    for(const row of m.rows){
      if(row.role==='detail'){
        const count=Math.max(row.parameters.length,row.results.length,row.standards.length);
        const parameter=rich(row.group,row.exceeded?1:0,true,true)+'\\P'+Array.from({length:count},(_,j)=>rich(row.parameters[j]||'',row.exceeded?1:0)).join('\\P');
        const results='\\P'+Array.from({length:count},(_,j)=>rich(row.results[j]||'',row.exceeded?1:0,true)).join('\\P');
        const standards='\\P'+Array.from({length:count},(_,j)=>rich(row.standards[j]||'')).join('\\P');
        grid.push([hidden(),cell(parameter,pf),cell(results,pf),cell(standards,nf)]);
        heights.push(Math.max(rh,(count+1)*pf*1.65+1.6));
      }else{
        const sample=[rich(row.sample||'',0,true),rich(row.note||''),row.depth?rich('('+row.depth+')',row.exceeded?1:87,true):''].filter(Boolean).join('\\P');
        const result=m.mode==='summary'?row.result:row.exceededGroups;
        grid.push([cell(sample,sf,row.sampleSpan||1),cell(rich(row.analyses||''),af),cell(rich(result||'',row.exceeded?1:0,true),pf,1,2),hidden()]);
        // Account for wrapped analysis/sample strings in the rendered table cache.
        const lines=Math.max(Math.ceil(String(row.analyses||'').length*af*.53/(widths[1]-1.8)),(row.note?1:0)+(row.depth?1:0)+Math.ceil(String(row.sample||'').length*sf*.53/(widths[0]-1.8)));
        heights.push(Math.max(rh,lines*Math.max(sf,af)*1.65+1.6));
      }
    }
    const column=i%4, insert=[column*(totalWidth+10),columnY[column],0];
    columnY[column]-=heights.reduce((a,b)=>a+b,0)+10;
    return {grid,heights,widths,insert,bh:m.bh,date};
  });
}
function build(models,options={}){
  const tables=layout(models,options);
  let next=0x1000;
  const handle=()=> (next++).toString(16).toUpperCase();
  const blockRecords=[],blocks=[],entities=[];
  const add=(out,...pairs)=>out.push(...pairs);
  // R2004 uses a legacy codepage. ASCII + DXF Unicode escapes is portable.
  const ascii=s=>String(s).replace(/[^\x00-\x7f]/g,c=>'\\U+'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
  const textTags=(out,text,continuation)=>{
    let s=ascii(text);
    while(s.length>250){add(out,[continuation,s.slice(0,250)]);s=s.slice(250);}
    add(out,[1,s]);
  };
  const fill=options.titleFill==='groundwater'?151:options.titleFill==='white'?255:51;
  const rgb=options.titleFill==='groundwater'?0x7fffff:options.titleFill==='white'?0xffffff:0xffff7f;
  const recordIndex=base.pairs.findIndex((p,i)=>p[0]===2&&p[1]==='BLOCK_RECORD'&&base.pairs[i-1][1]==='TABLE');
  const recordOwner=base.pairs[recordIndex+1][1];
  for(let i=0;i<tables.length;i++){
    const t=tables[i], br=handle(), name='*T'+(i+1);
    add(blockRecords,[0,'BLOCK_RECORD'],[5,br],[330,recordOwner],[100,'AcDbSymbolTableRecord'],[100,'AcDbBlockTableRecord'],[2,name],[340,'0'],[70,0],[280,1],[281,0]);
    add(blocks,[0,'BLOCK'],[5,handle()],[330,br],[100,'AcDbEntity'],[8,'0'],[100,'AcDbBlockBegin'],[2,name],[70,1],[10,0],[20,0],[30,0],[3,name],[1,'']);
    const start=(type,subclass,color)=>add(blocks,[0,type],[5,handle()],[330,br],[100,'AcDbEntity'],[8,'0'],[420,color],[100,subclass]);
    const xe=[0],ye=[0]; t.widths.forEach(w=>xe.push(xe.at(-1)+w));t.heights.forEach(h=>ye.push(ye.at(-1)-h));
    const segments=new Map();
    t.grid.forEach((row,r)=>row.forEach((c,col)=>{
      if(c.hidden)return;
      if(col+c.cs>4 || r+c.rs>t.grid.length)throw Error('Invalid table cell span.');
      const l=xe[col],rr=xe[col+c.cs],top=ye[r],bottom=ye[r+c.rs];
      start('SOLID','AcDbTrace',r===0?rgb:0xffffff);
      [[l,bottom],[rr,bottom],[l,top],[rr,top]].forEach(([x,y],k)=>add(blocks,[10+k,x],[20+k,y],[30+k,0]));
      const corners=[[l,bottom],[rr,bottom],[rr,top],[l,top]];
      corners.forEach((a,k)=>{const b=corners[(k+1)%4];const points=[a,b].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);segments.set(JSON.stringify(points),points);});
      if(c.text){
        start('MTEXT','AcDbMText',0);
        add(blocks,[10,(l+rr)/2],[20,(top+bottom)/2],[30,0],[40,c.size],[41,rr-l-1.8],[71,5],[72,1]);
        textTags(blocks,c.text,3);add(blocks,[7,'MAGIC_Arial'],[73,2],[44,1]);
      }
    }));
    for(const [a,b] of segments.values()){
      start('LINE','AcDbLine',0);add(blocks,[10,a[0]],[20,a[1]],[30,0],[11,b[0]],[21,b[1]],[31,0]);
    }
    add(blocks,[0,'ENDBLK'],[5,handle()],[330,br],[100,'AcDbEntity'],[8,'0'],[100,'AcDbBlockEnd']);
    add(entities,[0,'ACAD_TABLE'],[5,handle()],[330,base.modelHandle],[100,'AcDbEntity'],[8,'MAGIC_TABLES'],[100,'AcDbBlockReference'],[2,name],[10,t.insert[0]],[20,t.insert[1]],[30,0],[100,'AcDbTable'],[342,base.styleHandle],[343,br],[11,1],[21,0],[31,0],[90,22],[91,t.grid.length],[92,4],[93,0],[94,0],[95,0],[96,0]);
    t.heights.forEach(h=>add(entities,[141,h]));t.widths.forEach(w=>add(entities,[142,w]));
    t.grid.forEach((row,r)=>row.forEach(c=>{
      add(entities,[171,1],[172,0],[173,Number(c.hidden)],[174,0],[175,c.cs],[176,c.rs],[177,63],[178,0],[145,0]);
      textTags(entities,c.text,2);
      add(entities,[7,'MAGIC_Arial'],[140,c.size],[170,5],[64,250],[63,r===0?fill:255],[283,1]);
    }));
  }
  const width=tables[0].widths.reduce((a,b)=>a+b,0), maxX=Math.min(4,tables.length)*(width+10)-10;
  const minY=Math.min(...tables.map(t=>t.insert[1]-t.heights.reduce((a,b)=>a+b,0)));
  const output=[];
  let section='',symbolTable='',header='',inViewport=false;
  for(let i=0;i<base.pairs.length;i++){
    let [code,value]=base.pairs[i];
    const previous=base.pairs[i-1];
    if(code===2&&previous?.[1]==='SECTION')section=value;
    if(code===2&&previous?.[1]==='TABLE')symbolTable=value;
    if(code===9)header=value;
    if(section==='HEADER'){
      if(header==='$HANDSEED'&&code===5)value=next.toString(16).toUpperCase();
      if(header==='$EXTMIN'&&code===20)value=minY;
      if(header==='$EXTMAX'&&code===10)value=maxX;
      if(header==='$EXTMIN'&&[10,30].includes(code)||header==='$EXTMAX'&&[20,30].includes(code))value=0;
    }
    if(code===0)inViewport=value==='VPORT';
    if(inViewport){
      if(code===12)value=maxX/2;
      if(code===22)value=minY/2;
      if(code===40)value=Math.max(maxX*.8,-minY)+20;
    }
    if(code===70&&symbolTable==='BLOCK_RECORD'&&base.pairs[i-1]?.[1]==='AcDbSymbolTable')value=Number(value)+tables.length;
    if(code===0&&value==='ENDTAB'&&symbolTable==='BLOCK_RECORD')blockRecords.forEach(p=>output.push(p));
    if(code===0&&value==='ENDSEC'&&section==='BLOCKS')blocks.forEach(p=>output.push(p));
    if(code===0&&value==='ENDSEC'&&section==='ENTITIES')entities.forEach(p=>output.push(p));
    output.push([code,value]);
  }
  return output.map(([c,v])=>c+'\n'+v+'\n').join('');
}
const api={build,layout,escapeText};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TallyNativeDxf=api;
})(globalThis);
