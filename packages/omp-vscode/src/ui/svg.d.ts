// esbuild's `text` loader turns `import "./x.svg"` into a string of the
// file's contents. Give TS the same shape so imports type-check.
declare module "*.svg" {
  const content: string;
  export default content;
}
