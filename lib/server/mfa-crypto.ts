import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { LedgerStore } from './store';
import { ApiError } from './errors';

type Key={id:string;bytes:Buffer};
const error=()=>new ApiError(503,'auth_not_configured','Merchant MFA encryption is not configured.');
function keyFrom(value:string|undefined):Key|null{if(!value)return null;const bytes=Buffer.from(value,'base64');if(bytes.length!==32)throw error();return{id:createHash('sha256').update(bytes).digest('hex').slice(0,16),bytes};}
function currentKey(){const key=keyFrom(process.env.AGORA_MFA_ENCRYPTION_KEY);if(!key)throw error();return key;}
function keys(){const current=currentKey(),previous=keyFrom(process.env.AGORA_MFA_ENCRYPTION_KEY_PREVIOUS);return previous&&previous.id!==current.id?[current,previous]:[current];}
export function encryptMfaSecret(value:string){const key=currentKey(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key.bytes,iv),body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return`v2.${key.id}.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${body.toString('base64url')}`;}
function decryptWith(key:Key,ivText:string,tagText:string,bodyText:string){const iv=Buffer.from(ivText,'base64url'),tag=Buffer.from(tagText,'base64url'),body=Buffer.from(bodyText,'base64url');if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted MFA record');const decipher=createDecipheriv('aes-256-gcm',key.bytes,iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(body),decipher.final()]).toString('utf8');}
export function decryptMfaSecret(value:string){const parts=value.split('.');if(parts[0]==='v2'&&parts.length===5){const[,id,iv,tag,body]=parts;const candidate=keys().find(key=>key.id===id);if(!candidate)throw new ApiError(500,'mfa_key_unavailable','The saved authenticator key is unavailable.');try{return decryptWith(candidate,iv,tag,body);}catch{throw new ApiError(500,'mfa_secret_invalid','The saved authenticator secret is invalid.');}}
 if(parts[0]==='v1'&&parts.length===4){const[,iv,tag,body]=parts;for(const key of keys()){try{return decryptWith(key,iv,tag,body);}catch{}}throw new ApiError(500,'mfa_secret_invalid','The saved authenticator secret is invalid.');}
 throw new ApiError(500,'mfa_secret_invalid','The saved authenticator secret is invalid.');
}
export function migrateMfaSecrets(store:LedgerStore){let migrated=0,remainingOld=0;store.transaction(()=>{
 const ownerRows=store.all<{id:string;encrypted_secret:string}>('SELECT id,encrypted_secret FROM owner_mfa');
 const merchantRows=store.all<{id:string;mfa_secret:string}>('SELECT id,mfa_secret FROM merchant_users WHERE mfa_secret IS NOT NULL');
 if(ownerRows.length===0&&merchantRows.length===0)return;
 const current=currentKey();
 for(const row of ownerRows){if(row.encrypted_secret.startsWith(`v2.${current.id}.`))continue;const plain=decryptMfaSecret(row.encrypted_secret),encrypted=encryptMfaSecret(plain);store.run('UPDATE owner_mfa SET encrypted_secret=? WHERE id=? AND encrypted_secret=?',encrypted,row.id,row.encrypted_secret);migrated++;}
 for(const row of merchantRows){if(row.mfa_secret.startsWith(`v2.${current.id}.`))continue;const plain=decryptMfaSecret(row.mfa_secret),encrypted=encryptMfaSecret(plain);store.run('UPDATE merchant_users SET mfa_secret=?,updated_at=? WHERE id=? AND mfa_secret=?',encrypted,store.now(),row.id,row.mfa_secret);migrated++;}
 const ownerOld=store.one<{n:number}>('SELECT count(*) AS n FROM owner_mfa WHERE encrypted_secret NOT LIKE ?',`v2.${current.id}.%`)?.n||0;
 const merchantOld=store.one<{n:number}>('SELECT count(*) AS n FROM merchant_users WHERE mfa_secret IS NOT NULL AND mfa_secret NOT LIKE ?',`v2.${current.id}.%`)?.n||0;remainingOld=ownerOld+merchantOld;
 if(remainingOld)throw new ApiError(500,'mfa_migration_incomplete','MFA key rotation did not re-encrypt all records.');
});return{migrated,remaining_old:remainingOld};}
