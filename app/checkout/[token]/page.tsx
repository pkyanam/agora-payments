import Checkout from '@/components/checkout';
import { one } from '@/lib/server/db';
import { redirect } from 'next/navigation';
export default async function Page({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  const payment=one<{provider:string}>('SELECT provider FROM payments WHERE checkout_token=? AND sample=0',token);
  if(payment?.provider==='stripe')redirect(`/checkout/start#${token}`);
  return <Checkout token={token}/>;
}
