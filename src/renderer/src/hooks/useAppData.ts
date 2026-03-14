import { useAppDataStore } from '@/store/appDataStore'
import type { AppDataStore } from '@/store/appDataStore'

// ---------------------------------------------------------------------------
// useAppData — hook seletor tipado para o AppDataStore (A7)
//
// Uso:
//   const { colaboradores, postos, derivados } = useAppData()        // tudo
//   const empresa = useAppData(s => s.empresa)                       // seletor
//   const { N, K } = useAppData(s => s.derivados)                    // derivados
// ---------------------------------------------------------------------------

/** Retorna o store inteiro (re-render em qualquer mudança) */
export function useAppData(): AppDataStore

/** Retorna um slice do store (re-render só quando o slice muda) */
export function useAppData<T>(selector: (state: AppDataStore) => T): T

export function useAppData<T>(selector?: (state: AppDataStore) => T) {
  if (selector) {
    return useAppDataStore(selector)
  }
  return useAppDataStore()
}
