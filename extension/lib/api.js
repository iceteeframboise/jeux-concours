// Firefox expose "browser", Chrome expose "chrome" : on prend celui qui existe.
export const api = globalThis.browser ?? globalThis.chrome;
