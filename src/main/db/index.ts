import Database from 'better-sqlite3'
import { join } from 'path'
import { migrate } from './migrations'

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  migrate(db)
  return db
}

export function dbPathForUserData(userData: string): string {
  return join(userData, 'app.sqlite')
}
