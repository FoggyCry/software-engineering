import {uuid,AppError} from './domain';
export const STORES=['profiles','practices','attempts','wrongItems','dailyStats','meta','quarantine'] as const;
export type Store=typeof STORES[number];
export interface Meta { key:'state'; epoch:string; changeSeq:number; questionCount:number; dbSchemaVersion:1 }
export function request<T>(r:IDBRequest<T>):Promise<T>{return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export function openDB():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{
  const r=indexedDB.open('children-arithmetic',1);
  r.onupgradeneeded=()=>{const d=r.result;
    d.createObjectStore('profiles',{keyPath:'id'});
    const p=d.createObjectStore('practices',{keyPath:'id'});p.createIndex('byProfile','profileId');p.createIndex('byDate',['profileId','submittedDate','submittedAt','id']);p.createIndex('byDraftSlot','draftSlot',{unique:true});
    const a=d.createObjectStore('attempts',{keyPath:['practiceId','questionId']});a.createIndex('byPractice','practiceId');a.createIndex('byQuestion',['profileId','questionKey']);
    const w=d.createObjectStore('wrongItems',{keyPath:['profileId','questionKey']});w.createIndex('byProfile','profileId');w.createIndex('byPending',['profileId','pendingKey','reviewSortTime','questionKey']);
    d.createObjectStore('dailyStats',{keyPath:['profileId','date']});
    d.createObjectStore('meta',{keyPath:'key'}).put({key:'state',epoch:uuid(),changeSeq:0,questionCount:0,dbSchemaVersion:1});
    d.createObjectStore('quarantine',{keyPath:'practiceId'});
  };
  r.onsuccess=()=>{const db=r.result;db.onversionchange=()=>db.close();resolve(db);};
  r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new AppError('E_STORAGE','请关闭其他旧版页面，再重新打开。'));
});}
export async function transaction<T>(db:IDBDatabase,names:Store[],mode:IDBTransactionMode,fn:(t:IDBTransaction)=>Promise<T>):Promise<T>{
  const tx=db.transaction(names,mode);const done=new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error??new AppError('E_STORAGE','事务已取消，原数据保持不变。'));tx.onerror=()=>{};});
  // Attach immediately so abort during a request cannot produce an unhandled rejection.
  done.catch(()=>{});
  try{const result=await fn(tx);await done;return result;}catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
}
export const get=<T>(t:IDBTransaction,s:Store,k:IDBValidKey)=>request(t.objectStore(s).get(k)) as Promise<T|undefined>;
export const all=<T>(t:IDBTransaction,s:Store)=>request(t.objectStore(s).getAll()) as Promise<T[]>;
export const put=(t:IDBTransaction,s:Store,v:unknown)=>request(t.objectStore(s).put(v));
export const remove=(t:IDBTransaction,s:Store,k:IDBValidKey)=>request(t.objectStore(s).delete(k));
export const byIndex=<T>(t:IDBTransaction,s:Store,i:string,k:IDBValidKey)=>request(t.objectStore(s).index(i).getAll(k)) as Promise<T[]>;
