// Test-only adapter: the same PostgreSQL SQL runs against PGlite, never a mock of tenant/consent logic.
import { PGlite } from '@electric-sql/pglite';
import type { Driver } from './db';
export async function testDriver(): Promise<Driver> {
  const pg=new PGlite(); await pg.waitReady;
  type Engine = Pick<PGlite,'query'|'exec'|'transaction'>;
  const adapt=(engine: Engine): Driver=>({
    query: async <T extends Record<string,unknown>>(sql:string,params:unknown[]=[]) => (await engine.query<T>(sql,params)).rows,
    exec: async sql=>{ await engine.exec(sql); },
    transaction: async work=>engine.transaction(tx=>work(adapt(tx as unknown as Engine))),
    close: ()=>pg.close(),
  });
  return adapt(pg);
}
