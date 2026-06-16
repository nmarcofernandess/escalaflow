import { mapVoiceCaptureSnapshot } from '@/lib/ai-elements-adapters'

interface Props {
  recording: boolean
  transcribing: boolean
  text: string
  error?: string
}

export function FlowTranscriptionStatus({ recording, transcribing, text, error }: Props) {
  const snapshot = mapVoiceCaptureSnapshot({
    recording,
    transcribing,
    text,
    error,
    postProcessed: false,
  })

  if (snapshot.status === 'idle') return null

  return (
    <div className="text-xs text-muted-foreground" data-testid="flow-transcription-status">
      <span>{snapshot.label}</span>
      {snapshot.transcript ? <span>: {snapshot.transcript}</span> : null}
      {snapshot.error ? <span className="text-destructive"> {snapshot.error}</span> : null}
    </div>
  )
}
