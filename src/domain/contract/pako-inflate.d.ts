// Build UMD só de descompressão do pako; os tipos são os do pacote completo.
declare module 'pako/dist/pako_inflate.min.js' {
  import type { Inflate } from 'pako';
  const pakoInflate: { readonly Inflate: typeof Inflate };
  export default pakoInflate;
}
