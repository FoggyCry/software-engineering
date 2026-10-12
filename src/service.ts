import {AppError,requireThat,uuid,now,validNickname,gradeValid,generate,grade,shanghaiDate,attempts,reduceWrong,sortedWrong,type Profile,type Practice,type Wrong,type Question,type Answer} from './domain';
import {STORES,openDB,transaction,get,put,all,remove,byIndex,request,type Meta} from './db';
import {exportProfile,exportPractice,exportWrong,validateBackup,validatePractice,projections} from './backup';
type Params=Record<string,any>;
type Preview={token:string;expires:number;epoch:string;seq:number;parsed:ReturnType<typeof validateBackup>};
const writes=new Set(['profile.create','profile.update','practice.create','practice.save','practice.submit','review.create','backup.replace','data.delete']);
const spec:Record<string,string[]>={
  'profile.list':[], 'profile.create':['epoch','nickname','grade'], 'profile.update':['epoch','id','expectedProfileRevision','nickname','grade'],
  'practice.create':['epoch','profileId','expectedProfileRevision','grade','operators','count','replaceDraftId','replaceDraftRevision'],
  'practice.save':['epoch','id','expectedRevision','answers'],'practice.submit':['epoch','id','expectedRevision','answers','confirmBlank'],
  'practice.get':['id'],'practice.resume':['profileId'],'history.query':['profileId','from','to','cursor','limit'],'progress.today':['profileId'],
  'review.list':['profileId','cursor','limit'],'review.create':['epoch','profileId','expectedProfileRevision','replaceDraftId','replaceDraftRevision'],
  'backup.export':[],'backup.preview':['bytes'],'backup.replace':['epoch','token','confirmReplace'],
  'data.delete':['epoch','target','id','basisChangeSeq','confirm'],'print.read':['id','variant'],'health.inspect':[],'health.exportRaw':['practiceId'],
};
const fileStamp=()=>new Date(Date.now()+8*3600000).toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
export class Service {
  private preview:Preview|null=null;
  constructor(public db:IDBDatabase){}
  static async create(){return new Service(await openDB());}
  async execute(method:string,p:Params={}) {
    requireThat(spec[method]&&p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>spec[method].includes(k))&&spec[method].every(k=>Object.hasOwn(p,k)),'E_VALIDATION','接口参数缺失或包含未知字段。');
    if(method==='backup.preview'){
      requireThat(p.bytes instanceof ArrayBuffer,'E_VALIDATION','请选择备份文件。');const parsed=validateBackup(p.bytes);
      return transaction(this.db,['meta'],'readonly',async t=>{const m=await this.meta(t);const token=uuid();this.preview={token,expires:Date.now()+300000,epoch:m.epoch,seq:m.changeSeq,parsed};return this.response(m,{token,expiresAt:new Date(this.preview.expires).toISOString(),profileCount:parsed.backup.profiles.length,practiceCount:parsed.backup.practices.length,questionCount:parsed.backup.practices.reduce((n,p)=>n+p.questions.length,0),basisChangeSeq:m.changeSeq});});
    }
    const generated=method==='practice.create'?generate(p.grade,p.operators,p.count):null;
    // Full-store writes serialize exceptional rebuilding with normal writes.
    return transaction(this.db,[...STORES],writes.has(method)||method==='health.inspect'?'readwrite':'readonly',async t=>{
      const m=await this.meta(t);
      if(writes.has(method)){requireThat(p.epoch===m.epoch,'E_EPOCH','数据已由其他页面替换或删除，请重新选择档案。');}
      const finish=async(data:any,write=false)=>{if(write){m.changeSeq++;await put(t,'meta',m);}return this.response(m,data);};
      const profile=async(id:string)=>{const v=await get<Profile>(t,'profiles',id);requireThat(v,'E_NOT_FOUND','档案不存在，请返回首页。');return v;};
      const practice=async(id:string)=>{const v=await get<Practice>(t,'practices',id);requireThat(v,'E_NOT_FOUND','练习不存在。');requireThat(!await get(t,'quarantine',id),'E_CORRUPT','该练习已隔离，请在家长模式处理。');validatePractice(exportPractice(v));return v;};
      if(method==='profile.list')return finish({profiles:await all<Profile>(t,'profiles')});
      if(method==='profile.create'){
        const list=await all(t,'profiles');requireThat(list.length<5,'E_LIMIT','最多建立5个儿童档案。');requireThat(gradeValid(p.grade),'E_VALIDATION','请选择一至三年级。');const v:Profile={id:uuid(),nickname:validNickname(p.nickname),grade:p.grade,createdAt:now(),profileRevision:0};await put(t,'profiles',v);return finish(v,true);
      }
      if(method==='profile.update'){const v=await profile(p.id);requireThat(v.profileRevision===p.expectedProfileRevision,'E_CONFLICT','档案已更新，请刷新。');requireThat(gradeValid(p.grade),'E_VALIDATION','年级无效。');v.nickname=validNickname(p.nickname);v.grade=p.grade;v.profileRevision++;await put(t,'profiles',v);return finish(v,true);}
      if(method==='practice.create'||method==='review.create'){
        const pr=await profile(p.profileId);requireThat(pr.profileRevision===p.expectedProfileRevision,'E_CONFLICT','档案发生变化，请重试。');const kind=method==='practice.create'?'normal':'review';
        const drafts=await byIndex<Practice>(t,'practices','byDraftSlot',pr.id+':'+kind),old=drafts[0];
        requireThat(old?old.id===p.replaceDraftId&&old.revision===p.replaceDraftRevision:p.replaceDraftId===null&&p.replaceDraftRevision===null,'E_CONFLICT','已有练习草稿，请选择继续或确认替换。');
        let qs:Question[]=generated??[];
        if(kind==='review'){const ws=sortedWrong(await byIndex<Wrong>(t,'wrongItems','byProfile',pr.id)).slice(0,30);requireThat(ws.length,'E_NOT_FOUND','暂无待复习题，继续保持！');qs=ws.map((w,i)=>({id:uuid(),ordinal:i+1,sourceGrade:w.sourceGrade,ruleVersion:w.ruleVersion,a:w.a,b:w.b,op:w.op,expected:w.expected,answer:null}));}
        const total=m.questionCount-(old?.questions.length??0)+qs.length;requireThat(total<=50000,'E_LIMIT','已达到50000题容量，请先备份再清理档案。');
        const timestamp=now(),v:Practice={id:uuid(),profileId:pr.id,gradeSnapshot:kind==='normal'?p.grade:pr.grade,ruleVersion:1,kind,status:'draft',revision:0,createdAt:timestamp,updatedAt:timestamp,submittedAt:null,submittedDate:null,questions:qs,result:null,draftSlot:pr.id+':'+kind};
        if(old)await remove(t,'practices',old.id);await put(t,'practices',v);m.questionCount=total;return finish({...exportPractice(v),saveState:'saved'},true);
      }
      if(method==='practice.get'||method==='print.read'){
        const v=await practice(p.id);if(method==='print.read'){requireThat(['questions','answers'].includes(p.variant),'E_VALIDATION','打印类型无效。');return finish({profileNickname:(await profile(v.profileId)).nickname,gradeSnapshot:v.gradeSnapshot,practiceId:v.id,questions:v.questions,variant:p.variant});}return finish({...exportPractice(v),saveState:'saved'});
      }
      if(method==='practice.resume'){
        await profile(p.profileId);const list=(await byIndex<Practice>(t,'practices','byProfile',p.profileId)).filter(v=>v.status==='draft'),valid:Practice[]=[],warnings:any[]=[];
        for(const v of list){try{validatePractice(exportPractice(v));requireThat(!await get(t,'quarantine',v.id),'E_CORRUPT','已隔离');valid.push(v);}catch{warnings.push({id:v.id,code:'E_CORRUPT'});}}
        valid.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));return finish({normal:valid.find(p=>p.kind==='normal')??null,review:valid.find(p=>p.kind==='review')??null,recommendedId:valid[0]?.id??null,warnings});
      }
      if(method==='practice.save'||method==='practice.submit'){
        const v=await practice(p.id);requireThat(Array.isArray(p.answers)&&p.answers.length===v.questions.length,'E_VALIDATION','需要完整答案快照。');const answers=new Map<string,Answer>();
        for(const x of p.answers){requireThat(x&&Object.keys(x).length===2&&typeof x.questionId==='string'&&!answers.has(x.questionId)&&(x.value===null||(Number.isInteger(x.value)&&x.value>=0&&x.value<=9999)),'E_VALIDATION','答案字段不合法。');answers.set(x.questionId,x.value);}
        requireThat(v.questions.every(q=>answers.has(q.id)),'E_VALIDATION','答案与题单不匹配。');
        if(v.status==='submitted'){requireThat(method==='practice.submit'&&v.questions.every(q=>q.answer===answers.get(q.id)),'E_READ_ONLY','已提交的练习不能修改。');return finish({practice:exportPractice(v),result:v.result,replayed:true});}
        requireThat(v.revision===p.expectedRevision,'E_CONFLICT','另一页面更新了练习，请载入最新记录。');v.questions=v.questions.map(q=>({...q,answer:answers.get(q.id)!}));
        if(method==='practice.submit')requireThat(typeof p.confirmBlank==='boolean'&&(!v.questions.some(q=>q.answer===null)||p.confirmBlank),'E_BLANK_CONFIRM',`还有${v.questions.filter(q=>q.answer===null).length}题未答，请确认。`);
        v.revision++;v.updatedAt=now();
        if(method==='practice.submit'){
          v.status='submitted';v.submittedAt=v.updatedAt;v.submittedDate=shanghaiDate(v.submittedAt);v.result=grade(v.questions);delete v.draftSlot;
          for(const a of attempts(v)){await put(t,'attempts',a);const events=await byIndex<any>(t,'attempts','byQuestion',[v.profileId,a.questionKey]);const w=reduceWrong(events);if(w)await put(t,'wrongItems',w);else await remove(t,'wrongItems',[v.profileId,a.questionKey]);}
          if(v.kind==='normal'){const d=await get<any>(t,'dailyStats',[v.profileId,v.submittedDate])??{profileId:v.profileId,date:v.submittedDate,answeredCount:0,normalPracticeCount:0};d.answeredCount+=v.result.answeredCount;d.normalPracticeCount++;await put(t,'dailyStats',d);}
        }
        await put(t,'practices',v);return finish(method==='practice.submit'?{practice:exportPractice(v),result:v.result,replayed:false}:{id:v.id,revision:v.revision,updatedAt:v.updatedAt},true);
      }
      if(method==='progress.today'){await profile(p.profileId);const date=shanghaiDate(),d=await get<any>(t,'dailyStats',[p.profileId,date]);const excluded=(await all<any>(t,'quarantine')).filter(q=>q.profileId===p.profileId).length;return finish({date,answeredCount:d?.answeredCount??0,target:30,achieved:(d?.answeredCount??0)>=30,excludedCount:excluded});}
      if(method==='history.query'||method==='review.list'){
        await profile(p.profileId);requireThat(Number.isInteger(p.limit)&&p.limit>=1&&p.limit<=100,'E_VALIDATION','分页数量需要1至100。');
        let offset=0;if(p.cursor){try{const c=JSON.parse(atob(p.cursor));requireThat(c.seq===m.changeSeq&&c.profile===p.profileId&&c.method===method&&c.from===(p.from??null)&&c.to===(p.to??null)&&Number.isInteger(c.offset)&&c.offset>=0,'E_CONFLICT','记录已变化，请从第一页查看。');offset=c.offset;}catch(e){if(e instanceof AppError)throw e;throw new AppError('E_VALIDATION','分页位置无效。');}}
        let values:any[],excludedCount=0;
        if(method==='review.list')values=sortedWrong(await byIndex<Wrong>(t,'wrongItems','byProfile',p.profileId));
        else{
          requireThat(/^\d{4}-\d\d-\d\d$/.test(p.from)&&/^\d{4}-\d\d-\d\d$/.test(p.to)&&p.from<=p.to,'E_VALIDATION','请选择正确的起止日期。');
          const excluded=new Set((await all<any>(t,'quarantine')).filter(q=>q.profileId===p.profileId).map(q=>q.practiceId));excludedCount=excluded.size;
          values=(await request(t.objectStore('practices').index('byDate').getAll(IDBKeyRange.bound([p.profileId,p.from],[p.profileId,p.to,'\uffff','\uffff'])))).filter((v:Practice)=>v.status==='submitted'&&!excluded.has(v.id)).sort((a:Practice,b:Practice)=>b.submittedAt!.localeCompare(a.submittedAt!)||b.id.localeCompare(a.id)).map((v:Practice)=>({id:v.id,profileId:v.profileId,gradeSnapshot:v.gradeSnapshot,kind:v.kind,submittedAt:v.submittedAt,submittedDate:v.submittedDate,questionCount:v.questions.length,result:v.result}));
        }
        const items=values.slice(offset,offset+p.limit),nextCursor=offset+p.limit<values.length?btoa(JSON.stringify({seq:m.changeSeq,profile:p.profileId,method,from:p.from??null,to:p.to??null,offset:offset+p.limit})):null;return finish({items,nextCursor,excludedCount,total:values.length});
      }
      if(method==='backup.export'){
        requireThat(!(await all(t,'quarantine')).length,'E_CORRUPT','存在已隔离记录，请先导出诊断并处理，不能生成不完整备份。');
        const b={schemaVersion:1,exportedAt:now(),profiles:(await all<Profile>(t,'profiles')).map(exportProfile),practices:(await all<Practice>(t,'practices')).map(exportPractice),wrongItems:(await all<Wrong>(t,'wrongItems')).map(exportWrong)};const bytes=new TextEncoder().encode(JSON.stringify(b)).buffer;validateBackup(bytes);return finish({fileName:`oral-practice-backup-${fileStamp()}.json`,mime:'application/json;charset=utf-8',bytes});
      }
      if(method==='backup.replace'){
        const v=this.preview;requireThat(v&&v.token===p.token&&v.expires>=Date.now(),'E_PREVIEW_EXPIRED','预览已过期，请重新选择文件。');requireThat(p.confirmReplace===true&&v.epoch===m.epoch&&v.seq===m.changeSeq,'E_CONFLICT','预览后数据发生了变化，请重新预览。');
        for(const s of STORES)if(s!=='meta')await request(t.objectStore(s).clear());
        for(const x of v.parsed.backup.profiles)await put(t,'profiles',{...x,profileRevision:0});
        for(const x of v.parsed.backup.practices)await put(t,'practices',{...x,...(x.status==='draft'?{draftSlot:x.profileId+':'+x.kind}:{})});
        await this.putDerived(t,v.parsed.derived);m.epoch=uuid();m.questionCount=v.parsed.backup.practices.reduce((n,x)=>n+x.questions.length,0);this.preview=null;return finish({newEpoch:m.epoch,profileCount:v.parsed.backup.profiles.length,questionCount:m.questionCount},true);
      }
      if(method==='data.delete'){
        requireThat(p.confirm===true&&m.changeSeq===p.basisChangeSeq&&['all','profile','corruptPractice'].includes(p.target),'E_CONFLICT','删除预览已变化，请重新确认。');let deletedProfiles=0,deletedPractices=0;
        if(p.target==='all'){requireThat(p.id===null,'E_VALIDATION','清空操作参数无效。');deletedProfiles=(await all(t,'profiles')).length;deletedPractices=(await all(t,'practices')).length;for(const s of STORES)if(s!=='meta')await request(t.objectStore(s).clear());m.questionCount=0;}
        else{let list:Practice[]=[];if(p.target==='profile'){await profile(p.id);list=await byIndex<Practice>(t,'practices','byProfile',p.id);await remove(t,'profiles',p.id);deletedProfiles=1;}else{const q=await get<any>(t,'quarantine',p.id);requireThat(q,'E_NOT_FOUND','隔离记录不存在。');const raw=await get<Practice>(t,'practices',p.id);if(raw)list=[raw];}
          for(const v of list){await remove(t,'practices',v.id);await remove(t,'quarantine',v.id);deletedPractices++;}
          const remain=await all<Practice>(t,'practices'),bad=new Set((await all<any>(t,'quarantine')).map(q=>q.practiceId));m.questionCount=remain.reduce((n,v)=>n+v.questions.length,0);await this.rebuild(t,remain.filter(v=>!bad.has(v.id)));
        }
        m.epoch=uuid();return finish({newEpoch:m.epoch,deletedProfiles,deletedPractices,questionCount:m.questionCount},true);
      }
      if(method==='health.exportRaw'){const raw=await get(t,'practices',p.practiceId),q=await get<any>(t,'quarantine',p.practiceId);requireThat(raw&&q,'E_NOT_FOUND','诊断记录不存在。');return finish({fileName:`oral-practice-diagnostic-${p.practiceId}-${fileStamp()}.json`,bytes:new TextEncoder().encode(JSON.stringify({diagnosticVersion:1,exportedAt:now(),practiceId:p.practiceId,reasonCodes:q.reasonCodes,raw})).buffer});}
      if(method==='health.inspect'){
        const list=await all<Practice>(t,'practices'),profiles=await all<Profile>(t,'profiles'),bad:any[]=[],valid:Practice[]=[];let actualCount=0;
        for(const v of list){try{validatePractice(exportPractice(v));requireThat(profiles.some(p=>p.id===v.profileId),'E_CORRUPT','档案丢失');valid.push(v);}catch{bad.push({practiceId:v.id,profileId:v.profileId,reasonCodes:['E_CORRUPT'],detectedAt:now(),reservedQuestionCount:Array.isArray(v.questions)?v.questions.length:null});}if(Array.isArray(v.questions))actualCount+=v.questions.length;else actualCount=NaN;}
        requireThat(actualCount===m.questionCount,'E_CORRUPT','容量元数据与记录不一致，请使用备份恢复或清空。');
        const old=await all<any>(t,'quarantine');let changed=bad.length!==old.length||bad.some(q=>!old.some(x=>x.practiceId===q.practiceId));
        if(changed){await request(t.objectStore('quarantine').clear());for(const q of bad)await put(t,'quarantine',q);}
        const expected=projections(valid),current=await all<Wrong>(t,'wrongItems'),currentDaily=await all<any>(t,'dailyStats');
        const stable=(x:any[])=>JSON.stringify([...x].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
        if(changed||stable(current)!==stable(expected.wrongs)||stable(currentDaily)!==stable(expected.daily)){await this.rebuild(t,valid);changed=true;}
        return finish({mode:'persistent',issues:bad.map(q=>({practiceId:q.practiceId,code:'E_CORRUPT',recovery:'导出诊断后删除，或恢复备份。'})),epoch:m.epoch,changeSeq:m.changeSeq},changed);
      }
      throw new AppError('E_VALIDATION','未知操作。');
    });
  }
  private response(m:Meta,data:any){return{data,epoch:m.epoch,changeSeq:m.changeSeq};}
  private async meta(t:IDBTransaction){const m=await get<Meta>(t,'meta','state');requireThat(m&&typeof m.epoch==='string'&&Number.isSafeInteger(m.changeSeq)&&Number.isSafeInteger(m.questionCount)&&m.questionCount>=0&&m.questionCount<=50000,'E_CORRUPT','存储元数据损坏。请恢复有效备份，不要继续作答。');return m;}
  private async putDerived(t:IDBTransaction,d:ReturnType<typeof projections>){for(const x of d.attempts)await put(t,'attempts',x);for(const x of d.wrongs)await put(t,'wrongItems',x);for(const x of d.daily)await put(t,'dailyStats',x);}
  private async rebuild(t:IDBTransaction,ps:Practice[]){for(const s of ['attempts','wrongItems','dailyStats'] as const)await request(t.objectStore(s).clear());await this.putDerived(t,projections(ps));}
}
