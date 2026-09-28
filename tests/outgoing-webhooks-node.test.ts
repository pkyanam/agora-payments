import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createNodeWebhookFetch,resolvePinnedWebhookAddress} from '../lib/server/outgoing-webhooks-node';
import {isPublicWebhookAddress} from '../lib/server/outgoing-webhooks';

const localEnv={AGORA_DEPLOYMENT_TYPE:'community',AGORA_DEPLOYMENT_TARGET:'node',NODE_ENV:'test',AGORA_ALLOW_LOCAL_WEBHOOKS:'true'};

test('public address classifier blocks non-public and IPv4-mapped IPv6 literals',()=>{
  for(const address of ['127.0.0.1','10.0.0.1','100.64.0.1','169.254.169.254','192.0.2.1','198.18.0.1','224.0.0.1','::','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1','2001:20::1','ff02::1','64:ff9b::7f00:1'])assert.equal(isPublicWebhookAddress(address),false,address);
  for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicWebhookAddress(address),true,address);
});

test('Node refuses a public-looking hostname whose DNS answer is private',async()=>{
  let resolverCalls=0;
  await assert.rejects(resolvePinnedWebhookAddress('rebind.example',localEnv,async()=>{resolverCalls++;return[{address:'127.0.0.1',family:4}];}),/webhook_destination_blocked/);
  assert.equal(resolverCalls,1);
  await assert.rejects(resolvePinnedWebhookAddress('mixed.example',localEnv,async()=>[{address:'8.8.8.8',family:4},{address:'::1',family:6}]),/webhook_destination_blocked/);
});

test('Node transport pins the validated DNS address and never follows redirects',async()=>{
  let calls=0;let receivedPath='';let remoteAddress='';
  const server=createServer((request,response)=>{calls++;receivedPath=request.url||'';remoteAddress=request.socket.remoteAddress||'';response.statusCode=302;response.setHeader('Location','http://127.0.0.1/admin');response.end('ignored response body');});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');let resolverCalls=0;
    const transport=createNodeWebhookFetch(localEnv,async(hostname)=>{resolverCalls++;assert.equal(hostname,'pinned.localhost');return[{address:'::1',family:6},{address:'127.0.0.1',family:4}];});
    const response=await transport(`http://pinned.localhost:${address.port}/hook?x=1`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'manual'});
    assert.equal(response.status,302);assert.equal(resolverCalls,1);assert.equal(calls,1);assert.equal(receivedPath,'/hook?x=1');assert.equal(remoteAddress,'127.0.0.1');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('loopback webhook opt-in is unavailable outside community Node development',async()=>{
  await assert.rejects(resolvePinnedWebhookAddress('127.0.0.1',{...localEnv,AGORA_DEPLOYMENT_TYPE:'hosted'}),/webhook_destination_blocked/);
  await assert.rejects(resolvePinnedWebhookAddress('127.0.0.1',{...localEnv,NODE_ENV:'production'}),/webhook_destination_blocked/);
});
