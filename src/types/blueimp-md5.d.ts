/**
 * blueimp-md5 ships no type declarations. The module's default export is a single
 * function taking a string and returning its MD5 digest as lowercase hex.
 */
declare module 'blueimp-md5' {
  const md5: (value: string) => string;
  export default md5;
}
