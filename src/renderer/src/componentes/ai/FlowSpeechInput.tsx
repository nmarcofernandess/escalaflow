import { useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uint8ToBase64 } from '@/lib/audio-wav'
import { useAudioRecorder } from '@/hooks/useAudioRecorder'
import { servicoStt } from '@/servicos/stt'
import { FlowTranscriptionStatus } from './FlowTranscriptionStatus'

interface Props {
  disabled: boolean
  onTranscript: (text: string) => void
}

export function FlowSpeechInput({ disabled, onTranscript }: Props) {
  const recorder = useAudioRecorder()
  const [transcribing, setTranscribing] = useState(false)
  const [lastTranscript, setLastTranscript] = useState('')
  const [error, setError] = useState<string | undefined>()

  async function handleClick() {
    setError(undefined)
    try {
      if (!recorder.recording) {
        await recorder.start()
        return
      }

      setTranscribing(true)
      const wav = await recorder.stop()
      const result = await servicoStt.transcribe({
        wav_base64: uint8ToBase64(wav),
        post_process: false,
      })
      const transcript = result.text.trim()
      setLastTranscript(transcript)
      if (transcript) onTranscript(transcript)
    } catch (err) {
      recorder.cancel()
      setError(err instanceof Error ? err.message : 'Verifique o microfone e o modelo de ditado local.')
    } finally {
      setTranscribing(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={recorder.recording ? 'destructive' : 'ghost'}
        size="icon"
        className="size-7 rounded-full"
        aria-label={recorder.recording ? 'Parar ditado' : 'Iniciar ditado'}
        title={recorder.recording ? 'Parar ditado' : 'Iniciar ditado'}
        disabled={transcribing || (disabled && !recorder.recording)}
        onClick={() => void handleClick()}
      >
        {recorder.recording ? <Square className="size-3.5" /> : <Mic className="size-4" />}
      </Button>
      <FlowTranscriptionStatus
        recording={recorder.recording}
        transcribing={transcribing}
        text={lastTranscript}
        error={error}
      />
    </div>
  )
}
