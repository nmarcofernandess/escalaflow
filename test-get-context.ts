/**
 * Teste: Mostra o JSON completo do get_context
 */

import Database from 'better-sqlite3'
import { executeTool } from './src/main/ia/tools'

const db = Database('data/escalaflow.db', { readonly: true })
global.mockDb = db

async function testar() {
    console.log('🔍 Executando get_context...\n')

    const result = await executeTool('get_context', {})

    console.log(JSON.stringify(result, null, 2))

    db.close()
}

testar().catch(console.error)
