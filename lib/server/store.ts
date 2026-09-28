export type SqlValue = string | number | bigint | null | Uint8Array | ArrayBuffer;

export interface LedgerStore {
  one<T>(sql:string,...args:SqlValue[]):T|undefined;
  all<T>(sql:string,...args:SqlValue[]):T[];
  run(sql:string,...args:SqlValue[]):unknown;
  transaction<T>(fn:()=>T):T;
  id(prefix:string):string;
  now():string;
  event(type:string,actor:string,object_id:string,data?:object,tenantId?:string):string;
  journal(reference:string,amount:number,account:string,tenantId?:string):void;
  scheduleWebhookAlarm?():void;
}
