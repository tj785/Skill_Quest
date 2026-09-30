/** Minimal Express-compatible router for the offline build (routes run unchanged). */
type Handler = (req: any, res: any, next: (err?: any) => void) => any;
interface Layer { method: string | null; re: RegExp | null; keys: string[]; prefix: boolean; handlers: (Handler | RouterT)[]; }
export interface RouterT { (req: any, res: any, next: (err?: any) => void): void; __router: true; use: any; get: any; post: any; put: any; patch: any; delete: any; }

function compile(path: string, prefix: boolean) {
  const keys: string[] = [];
  const src = path.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+?)'; });
  return { re: new RegExp(`^${src}${prefix ? '(?=/|$)' : '/?$'}`), keys };
}

export function Router(): RouterT {
  const stack: Layer[] = [];
  const add = (method: string | null, prefix: boolean) => (...args: any[]) => {
    let path: string | null = null;
    if (typeof args[0] === 'string') path = args.shift();
    const c = path ? compile(path, prefix) : { re: null, keys: [] };
    stack.push({ method, re: c.re, keys: c.keys, prefix, handlers: args.flat() });
    return router;
  };
  const router = ((req: any, res: any, out: (err?: any) => void) => {
    let i = 0;
    const basePath = req.path as string;
    const next = (err?: any): void => {
      req.path = basePath;
      if (res.finished) return;
      const layer = stack[i++];
      if (!layer) return out(err);
      if (layer.method && layer.method !== req.method) return next(err);
      let params: Record<string, string> = {};
      let rest = basePath;
      if (layer.re) {
        const m = layer.re.exec(basePath);
        if (!m) return next(err);
        layer.keys.forEach((k, j) => (params[k] = decodeURIComponent(m[j + 1])));
        if (layer.prefix) rest = basePath.slice(m[0].length) || '/';
      }
      req.params = { ...(req.params ?? {}), ...params };
      let h = 0;
      const step = (e?: any): void => {
        const fn = layer.handlers[h++];
        if (!fn) return next(e);
        try {
          if ((fn as any).__router) { req.path = rest; (fn as any)(req, res, (e2: any) => { req.path = basePath; step(e2); }); return; }
          if (e !== undefined) { if (fn.length === 4) (fn as any)(e, req, res, step); else step(e); return; }
          if (fn.length === 4) return step();
          const r = (fn as Handler)(req, res, step);
          if (r && typeof r.catch === 'function') r.catch(step);
        } catch (x) { step(x); }
      };
      step(err);
    };
    next();
  }) as RouterT;
  router.__router = true;
  router.use = add(null, true);
  router.get = add('GET', false); router.post = add('POST', false); router.put = add('PUT', false);
  router.patch = add('PATCH', false); router.delete = add('DELETE', false);
  return router;
}
const express = Object.assign(() => Router(), { Router, json: () => (_q: any, _s: any, n: any) => n(), static: () => (_q: any, _s: any, n: any) => n() });
export default express;
export type Request = any; export type Response = any; export type NextFunction = any; export type RequestHandler = any;
