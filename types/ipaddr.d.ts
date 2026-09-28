declare module 'ipaddr.js' {
  interface Address {
    kind(): 'ipv4'|'ipv6';
    range(): string;
    toString(): string;
  }
  export interface IPv4 extends Address {
    kind(): 'ipv4';
    toByteArray(): number[];
  }
  export interface IPv6 extends Address {
    kind(): 'ipv6';
    toByteArray(): number[];
  }
  const ipaddr:{parse(input:string):IPv4|IPv6};
  export default ipaddr;
}
