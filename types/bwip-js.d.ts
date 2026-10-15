// bwip-js publishes its types only under the "node" export condition, which
// this project's TypeScript settings do not read. This declares the one
// function BiomedIntel.ai uses (server-side only), copied from
// node_modules/bwip-js/dist/bwip-js-node.d.ts (bwip-js 4.11.4).
declare module "bwip-js" {
  export interface RawOptions {
    bcid: string;
    text: string;
  }
  export function raw(options: RawOptions): Array<{ bbs: number[]; bhs: number[]; sbs: number[] }>;
  const bwipjs: { raw: typeof raw };
  export default bwipjs;
}
