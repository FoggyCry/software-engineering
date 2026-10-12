import { AppError,requireThat,validNickname,gradeValid,validQuestion,grade,key,attempts,reduceWrong,OPS,shanghaiDate,type Profile,type Practice,type Wrong,type Attempt } from './domain';
export interface Backup { schemaVersion:1; exportedAt:string; profiles:Omit<Profile,'profileRevision'>[]; practices:Practice[]; wrongItems:Partial<Wrong>[] }
const profileFields=['id','nickname','grade','createdAt'];
const practiceFields=['id','profileId','gradeSnapshot','ruleVersion','kind','status','revision','createdAt','updatedAt','submittedAt','submittedDate','questions','result'];
const questionFields=['id','ordinal','sourceGrade','ruleVersion','a','b','op','expected','answer'];
const resultFields=['correctCount','wrongCount','blankCount','answeredCount','accuracy'];
export const wrongFields=['profileId','questionKey','a','op','b','expected','wrongCount','lastWrongAt','needsReview'];
export function fields(v:unknown, names:string[],path:string):asserts v is Record<string,any> {requireThat(v!==null&&typeof v==='object'&&!Array.isArray(v),'E_CORRUPT',`${path}必须是对象。`);const k=Object.keys(v);requireThat(k.length===names.length&&k.every(x=>names.includes(x)),'E_CORRUPT',`${path}字段缺失或含未知字段。`);}
const isId=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
function time(v:unknown):string {requireThat(typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)),'E_CORRUPT','时间格式无效。');return new Date(v).toISOString();}
export function pick(v:any,names:string[]):any { return Object.fromEntries(names.map(k=>[k,v[k]])); }
export function exportProfile(p:Profile){return pick(p,profileFields);}
export function exportPractice(p:Practice):Practice{return pick(p,practiceFields);}
export function exportWrong(w:Wrong){return pick(w,wrongFields);}
export function validatePractice(raw:unknown):Practice {
  fields(raw,practiceFields,'Practice');const p=raw as unknown as Practice;
  requireThat(isId(p.id)&&isId(p.profileId)&&gradeValid(p.gradeSnapshot)&&p.ruleVersion===1&&['normal','review'].includes(p.kind)&&['draft','submitted'].includes(p.status)&&Number.isSafeInteger(p.revision)&&p.revision>=0,'E_CORRUPT','题单基本字段不合法。');
  p.createdAt=time(p.createdAt);p.updatedAt=time(p.updatedAt);
  requireThat(Array.isArray(p.questions)&&p.questions.length>=1&&p.questions.length<=30&&(p.kind==='review'||[10,20,30].includes(p.questions.length)),'E_CORRUPT','题单数量不合法。');
  const ids=new Set<string>(),keys=new Set<string>();
  p.questions.forEach((q,i)=>{fields(q,questionFields,`questions[${i}]`);requireThat(isId(q.id)&&!ids.has(q.id)&&q.ordinal===i+1&&validQuestion(q)&&(q.answer===null||(Number.isSafeInteger(q.answer)&&q.answer>=0&&q.answer<=9999)),'E_CORRUPT',`第${i+1}题不合法。`);requireThat(p.kind==='review'||q.sourceGrade===p.gradeSnapshot,'E_CORRUPT','普通题单年级不一致。');requireThat(!keys.has(key(q)),'E_CORRUPT','题单有重复题。');ids.add(q.id);keys.add(key(q));});
  if(p.kind==='normal'){const selected=OPS.filter(op=>p.questions.some(q=>q.op===op));selected.forEach((op,i)=>requireThat(p.questions.filter(q=>q.op===op).length===Math.floor(p.questions.length/selected.length)+(i<p.questions.length%selected.length?1:0),'E_CORRUPT','题型配额不正确。'));}
  if(p.status==='draft')requireThat(p.result===null&&p.submittedAt===null&&p.submittedDate===null,'E_CORRUPT','草稿不能有提交成绩。');
  else{p.submittedAt=time(p.submittedAt);requireThat(p.submittedDate===shanghaiDate(p.submittedAt),'E_CORRUPT','提交日期不一致。');fields(p.result,resultFields,'Result');const r=grade(p.questions);requireThat(resultFields.every(k=>(p.result as any)[k]===(r as any)[k]),'E_CORRUPT','成绩与作答不一致。');}
  return p;
}
export function projections(practices:Practice[]) {
  const all:Attempt[]=[],groups=new Map<string,Attempt[]>(),daily=new Map<string,{profileId:string;date:string;answeredCount:number;normalPracticeCount:number}>();
  for(const p of practices.filter(p=>p.status==='submitted')){
    for(const a of attempts(p)){all.push(a);const k=a.profileId+'|'+a.questionKey;const group=groups.get(k)??[];group.push(a);groups.set(k,group);}
    if(p.kind==='normal'){const k=p.profileId+'|'+p.submittedDate;const d=daily.get(k)??{profileId:p.profileId,date:p.submittedDate!,answeredCount:0,normalPracticeCount:0};d.answeredCount+=p.result!.answeredCount;d.normalPracticeCount++;daily.set(k,d);}
  }
  const wrongs=[...groups.values()].map(reduceWrong).filter((x):x is Wrong=>!!x);return{attempts:all,wrongs,daily:[...daily.values()]};
}
export function validateBackup(bytes:ArrayBuffer):{backup:Backup;derived:ReturnType<typeof projections>} {
  requireThat(bytes.byteLength<=50*1024*1024,'E_LIMIT','备份不能超过50MiB。');let b:any;
  try{b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError('E_CORRUPT','文件不是有效的UTF-8 JSON。');}
  fields(b,['schemaVersion','exportedAt','profiles','practices','wrongItems'],'Backup');requireThat(b.schemaVersion===1,'E_VERSION','不支持的备份版本。');b.exportedAt=time(b.exportedAt);
  requireThat(Array.isArray(b.profiles)&&b.profiles.length<=5&&Array.isArray(b.practices)&&b.practices.length<=50000&&Array.isArray(b.wrongItems)&&b.wrongItems.length<=50000,'E_LIMIT','备份超过容量限制。');
  const profiles=new Set<string>();for(const p of b.profiles){fields(p,profileFields,'Profile');requireThat(isId(p.id)&&!profiles.has(p.id)&&gradeValid(p.grade)&&validNickname(p.nickname)===p.nickname,'E_CORRUPT','档案不合法或编号重复。');p.createdAt=time(p.createdAt);profiles.add(p.id);}
  const ids=new Set<string>(),qids=new Set<string>(),drafts=new Set<string>();let count=0;
  for(const p of b.practices){validatePractice(p);requireThat(profiles.has(p.profileId)&&!ids.has(p.id),'E_CORRUPT','题单档案缺失或编号重复。');ids.add(p.id);for(const q of p.questions){requireThat(!qids.has(q.id),'E_CORRUPT','问题编号重复。');qids.add(q.id);}count+=p.questions.length;requireThat(count<=50000,'E_LIMIT','备份超过50000题。');if(p.status==='draft'){const slot=p.profileId+':'+p.kind;requireThat(!drafts.has(slot),'E_CORRUPT','同档案有多个相同类型草稿。');drafts.add(slot);}}
  const derived=projections(b.practices), byKey=new Map(derived.wrongs.map(w=>[w.profileId+'|'+w.questionKey,w]));
  requireThat(b.wrongItems.length===derived.wrongs.length,'E_CORRUPT','错题记录与历史不一致。');const seen=new Set<string>();
  for(const w of b.wrongItems){fields(w,wrongFields,'WrongItem');w.lastWrongAt=time(w.lastWrongAt);const k=w.profileId+'|'+w.questionKey,actual=byKey.get(k);requireThat(actual&&!seen.has(k)&&wrongFields.every(f=>w[f]===(actual as any)[f]),'E_CORRUPT','错题记录与重算结果不一致。');seen.add(k);}
  return{backup:b as unknown as Backup,derived};
}
