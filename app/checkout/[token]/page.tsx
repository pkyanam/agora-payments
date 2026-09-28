import Checkout from '@/components/checkout';
export default async function Page({params}:{params:Promise<{token:string}>}){return <Checkout token={(await params).token}/>}
