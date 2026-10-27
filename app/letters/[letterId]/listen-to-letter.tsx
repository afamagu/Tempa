'use client'

import { useEffect, useRef, useState } from 'react'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'

const SPEEDS = [0.85, 1, 1.15, 1.3] as const

/**
 * Private, device-native narration. No audio or letter content is sent to
 * Tempa or a third-party TTS API. The browser chooses its installed voice.
 */
export default function ListenToLetter({ body }: { body: string }) {
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle')
  const [speed, setSpeed] = useState<number>(1)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const sessionRef = useRef(0)
  const [voiceName, setVoiceName] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window)
    const updateVoices = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    updateVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', updateVoices)
    return () => {
      window.speechSynthesis?.removeEventListener?.('voiceschanged', updateVoices)
      sessionRef.current += 1
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
      utteranceRef.current = null
    }
  }, [])

  if (!supported) return null

  function stop() {
    sessionRef.current += 1
    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setState('idle')
  }

  function play() {
    const synth = window.speechSynthesis
    if (state === 'playing') {
      synth.pause()
      setState('paused')
      return
    }
    if (state === 'paused' && synth.paused) {
      synth.resume()
      setState('playing')
      return
    }
    synth.cancel()
    const clean = stripRichBodyMarker(body).body
    const text = clean.replace(/\*\*/g, '').replace(/\\([*_\\])/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
    if (!text) return
    const utterance = new SpeechSynthesisUtterance(text)
    const chosen = voices.find((voice) => voice.voiceURI === voiceName)
    if (chosen) utterance.voice = chosen
    utterance.rate = speed
    utterance.lang = document.documentElement.lang || navigator.language || 'en'
    utterance.onend = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null
        setState('idle')
      }
    }
    utterance.onerror = () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null
        setState('idle')
      }
    }
    utteranceRef.current = utterance
    synth.speak(utterance)
    setState('playing')
  }

  return (
    <div aria-label="Letter audio controls" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-foreground/10 bg-background px-3 py-2 text-[13px]">
      <button type="button" onClick={play} aria-label={state === 'playing' ? 'Pause reading' : state === 'paused' ? 'Resume reading' : 'Listen to letter'} className="rounded-md px-2 py-1 font-medium text-foreground hover:bg-foreground/5">
        {state === 'playing' ? 'Pause' : state === 'paused' ? 'Continue listening' : '♫ Listen to letter'}
      </button>
      {state !== 'idle' && (
        <button type="button" onClick={stop} className="rounded-md px-2 py-1 text-muted hover:bg-foreground/5">Stop</button>
      )}
      {voices.length > 0 && <label className="flex items-center gap-2 text-muted">Voice <select aria-label="Reading voice" className="max-w-36 rounded border border-foreground/15 bg-background px-2 py-1 text-foreground" value={voiceName} onChange={(e) => { setVoiceName(e.target.value); if (state !== 'idle') stop() }}><option value="">Device default</option>{voices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} ({voice.lang})</option>)}</select></label>}
      <label className="ml-auto flex items-center gap-2 text-muted">
        Speed
        <select aria-label="Reading speed" value={speed} onChange={(event) => {
          const next = Number(event.target.value)
          setSpeed(next)
          if (state !== 'idle') stop()
        }} className="rounded border border-foreground/15 bg-background px-2 py-1 text-foreground">
          {SPEEDS.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
      </label>
    </div>
  )
}
