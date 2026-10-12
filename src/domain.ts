export type Grade = 1 | 2 | 3;
export type Op = '+' | '-' | '*' | '/';
export type Answer = number | null;
export interface Profile { id:string; nickname:string; grade:Grade; createdAt:string; profileRevision:number }
export interface Question { id:string; ordinal:number; sourceGrade:Grade; ruleVersion:1; a:number; b:number; op:Op; expected:number; answer:Answer }
export interface Result { correctCount:number; wrongCount:number; blankCount:number; answeredCount:number; accuracy:number }
export interface Practice { id:string; profileId:string; gradeSnapshot:Grade; ruleVersion:1; kind:'normal'|'review'; status:'draft'|'submitted'; revision:number; createdAt:string; updatedAt:string; submittedAt:string|null; submittedDate:string|null; questions:Question[]; result:Result|null; draftSlot?:string }
export interface Wrong { profileId:string; questionKey:string; a:number; b:number; op:Op; expected:number; wrongCount:number; lastWrongAt:string; needsReview:boolean; sourceGrade:Grade; ruleVersion:1; representativePracticeId:string; representativeQuestionId:string; pendingKey:number; reviewSortTime:number }
export interface Attempt { practiceId:string; questionId:string; profileId:string; questionKey:string; submittedAt:string; ordinal:number; kind:Practice['kind']; a:number; b:number; op:Op; expected:number; answer:Answer; sourceGrade:Grade; ruleVersion:1 }
export const OPS:Op[] = ['+','-','*','/'];
export const SYMBOL:Record<Op,string> = {'+':'+','-':'−','*':'×','/':'÷'};
export class AppError extends Error { constructor(public code:string, message:string) { super(message); } }
export function requireThat(condition:unknown, code:string, message:string):asserts condition { if(!condition) throw new AppError(code,message); }
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function shanghaiDate(time:string|Date = new Date()):string { return new Date(new Date(time).getTime()+8*3600000).toISOString().slice(0,10); }
export function validNickname(value:unknown):string {
  requireThat(typeof value==='string','E_VALIDATION','昵称需要是文字。');
  const n=value.trim(); requireThat([...n].length>=1&&[...n].length<=20&&!/\p{Cc}/u.test(n),'E_VALIDATION','昵称需要1至20个字符，不能包含控制字符。'); return n;
}
export const gradeValid=(g:unknown):g is Grade=>g===1||g===2||g===3;
export function normalizeAnswer(raw:string):Answer {
  const s=raw.replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).trim();
  if(!s)return null;
  requireThat(/^\d{1,4}$/.test(s),'E_VALIDATION','请输入0至9999的整数，或留空。'); return Number(s);
}
export function expected(a:number,b:number,op:Op):number { return op==='+'?a+b:op==='-'?a-b:op==='*'?a*b:a/b; }
export function key(q:Pick<Question,'a'|'b'|'op'>):string { let {a,b,op}=q; if((op==='+'||op==='*')&&a>b)[a,b]=[b,a]; return `${op}:${a}:${b}`; }
export function validQuestion(q:Question):boolean {
  if(!gradeValid(q.sourceGrade)||q.ruleVersion!==1||!OPS.includes(q.op)||![q.a,q.b,q.expected].every(Number.isSafeInteger))return false;
  const {a,b,op,sourceGrade:g}=q, m=g===1?20:g===2?100:1000;
  if(a<0||b<0||q.expected!==expected(a,b,op))return false;
  if(op==='+')return a+b<=m;
  if(op==='-')return b<=a&&a<=m;
  if(g===1)return false;
  if(op==='*')return g===2?a>=1&&a<=9&&b>=1&&b<=9:a>=10&&a<=99&&b>=1&&b<=9;
  const quotient=a/b;return Number.isInteger(quotient)&&quotient>=1&&quotient<=(g===2?9:99)&&b>=(g===2?1:2)&&b<=9&&a<=(g===2?81:1000);
}
export function poolSize(g:Grade,op:Op):number { const m=g===1?20:g===2?100:1000; return op==='+'?(m/2+1)**2:op==='-'?(m+1)*(m+2)/2:g===1?0:op==='*'?(g===2?45:810):(g===2?81:792); }
export function decode(g:Grade,op:Op,rank:number):[number,number] {
  requireThat(Number.isInteger(rank)&&rank>=0&&rank<poolSize(g,op),'E_POOL','题库序号超出范围。');
  const m=g===1?20:g===2?100:1000;
  if(op==='+') { let lo=0,hi=m/2; while(lo<hi){const mid=Math.ceil((lo+hi)/2); if(mid*(m+2-mid)<=rank)lo=mid;else hi=mid-1;} return [lo,lo+rank-lo*(m+2-lo)]; }
  if(op==='-') {let lo=0,hi=m;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(mid*(mid+1)/2<=rank)lo=mid;else hi=mid-1;}return [lo,rank-lo*(lo+1)/2];}
  if(op==='*'){if(g===3)return [10+Math.floor(rank/9),1+rank%9];for(let a=1;a<=9;a++){if(rank<10-a)return[a,a+rank];rank-=10-a;}}
  const length=g===2?9:99,d=(g===2?1:2)+Math.floor(rank/length),q=1+rank%length;return[d*q,d];
}
export function randomInt(n:number):number { const limit=Math.floor(4294967296/n)*n;for(let i=0;i<128;i++){const v=crypto.getRandomValues(new Uint32Array(1))[0];if(v<limit)return v%n;}throw new AppError('E_RANDOM','随机源暂不可用，请重试。'); }
export function generate(g:Grade,operators:Op[],count:number,rand:(n:number)=>number=randomInt):Question[] {
  requireThat(gradeValid(g)&&[10,20,30].includes(count)&&Array.isArray(operators)&&operators.length>0&&new Set(operators).size===operators.length&&operators.every(o=>OPS.includes(o)&&poolSize(g,o)>0),'E_VALIDATION','请选择合法年级、题型与题数。');
  const selected=OPS.filter(o=>operators.includes(o)), questions:Question[]=[];
  selected.forEach((op,i)=>{const take=Math.floor(count/selected.length)+(i<count%selected.length?1:0),size=poolSize(g,op),map=new Map<number,number>();requireThat(size>=take,'E_POOL','题库数量不足。');for(let j=0;j<take;j++){const r=rand(size-j),rank=map.get(r)??r;map.set(r,map.get(size-j-1)??size-j-1);let [a,b]=decode(g,op,rank);if((op==='+'||(op==='*'&&g===2))&&rand(2))[a,b]=[b,a];questions.push({id:uuid(),ordinal:0,sourceGrade:g,ruleVersion:1,a,b,op,expected:expected(a,b,op),answer:null});}});
  for(let i=questions.length-1;i>0;i--){const j=rand(i+1);[questions[i],questions[j]]=[questions[j],questions[i]];}return questions.map((q,i)=>({...q,ordinal:i+1}));
}
export function grade(questions:Question[]):Result {
  let correctCount=0,wrongCount=0,blankCount=0;
  for(const q of questions){requireThat(validQuestion(q),'E_CORRUPT','题目规则校验失败。');requireThat(q.answer===null||(Number.isInteger(q.answer)&&q.answer>=0&&q.answer<=9999),'E_VALIDATION','答案格式错误。');if(q.answer===null)blankCount++;else if(q.answer===q.expected)correctCount++;else wrongCount++;}
  const n=questions.length;requireThat(n>0,'E_CORRUPT','题单不能为空。');return {correctCount,wrongCount,blankCount,answeredCount:correctCount+wrongCount,accuracy:Math.floor((2000*correctCount+n)/(2*n))/10};
}
export function attempts(p:Practice):Attempt[] { return p.questions.map(q=>({practiceId:p.id,questionId:q.id,profileId:p.profileId,questionKey:key(q),submittedAt:p.submittedAt!,ordinal:q.ordinal,kind:p.kind,a:q.a,b:q.b,op:q.op,expected:q.expected,answer:q.answer,sourceGrade:q.sourceGrade,ruleVersion:q.ruleVersion})); }
export function reduceWrong(events:Attempt[]):Wrong|null {
  let w:Wrong|null=null;
  let wrongCount=0;
  for(const e of [...events].sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt)||a.practiceId.localeCompare(b.practiceId)||a.ordinal-b.ordinal)){
    if(e.answer===null||e.answer!==e.expected)w={profileId:e.profileId,questionKey:e.questionKey,a:e.a,b:e.b,op:e.op,expected:e.expected,wrongCount:++wrongCount,lastWrongAt:e.submittedAt,needsReview:true,sourceGrade:e.sourceGrade,ruleVersion:e.ruleVersion,representativePracticeId:e.practiceId,representativeQuestionId:e.questionId,pendingKey:1,reviewSortTime:-Date.parse(e.submittedAt)};
    else if(w&&e.kind==='review'){w.needsReview=false;w.pendingKey=0;}
  }return w;
}
export function sortedWrong(items:Wrong[]):Wrong[] {return items.filter(w=>w.needsReview).sort((a,b)=>b.lastWrongAt.localeCompare(a.lastWrongAt)||a.questionKey.localeCompare(b.questionKey));}
