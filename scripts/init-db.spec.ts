import { getDb, closeDb } from '../src/main/db/database'
import { seedData } from '../src/main/db/seed'
import path from 'node:path'

process.env.ESCALAFLOW_DB_PATH = path.join(process.cwd(), 'data', 'escalaflow.db')

try {
  const db = getDb() // init tables
  
  const fs = require('fs')
  // We can just run the initialization from database.ts since it defines createTables
  // Wait, createTables is not exported. It's called internally by getDb? 
  // Let's check how getDb initializes the tables.
} catch (e) {
  console.log('Error:', e)
} finally {
  closeDb()
}
