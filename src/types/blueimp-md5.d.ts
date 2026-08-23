/**
 * blueimp-md5 ships no type declarations. The module's default export is a single
 * function taking a string and returning its MD5 digest as lowercase hex. Passing a
 * second argument computes HMAC-MD5 with that string as the key instead.
 */
declare module 'blueimp-md5' {
  const md5: (value: string, key?: string) => string;
  export default md5;
}
