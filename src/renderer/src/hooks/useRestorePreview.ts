import { useRestorePreviewStore } from '@/store/restorePreviewStore'

export function useRestorePreview() {
  const active = useRestorePreviewStore((s) => s.active)
  const snapshotLabel = useRestorePreviewStore((s) => s.snapshotLabel)
  return { isPreviewMode: active, snapshotLabel: active ? snapshotLabel : undefined }
}
