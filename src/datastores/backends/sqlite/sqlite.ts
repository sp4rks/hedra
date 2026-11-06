import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { ConfigBackend } from '#datastores/categories/config/config.ts'
import type { Tenant } from '#models/tenant.ts'

export class SqliteBackend implements ConfigBackend {
  private readonly db: Database

  /** Opens the database and prepares configuration storage. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true, strict: true })

    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS hedra_config_tenants (
          id TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL
        )
      `)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /** Inserts tenant configuration using bound parameters. */
  async insertTenant(tenant: Tenant): Promise<void> {
    this.db.run('INSERT INTO hedra_config_tenants (id, data) VALUES (?, ?)', [tenant.id, JSON.stringify(tenant)])
  }

  /** Closes the database after all stores have finished using it. */
  close(): void {
    this.db.close()
  }
}
