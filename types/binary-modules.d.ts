// Workers Data modules: the Cloudflare Vite plugin uploads `.bin` imports as ArrayBuffer modules.
declare module "*.bin" {
  const data: ArrayBuffer;
  export default data;
}
