// vite env.d overview
/// <reference types="vite/client" />

declare module '*.glsl?raw' {
  const value: string;
  export default value;
}
