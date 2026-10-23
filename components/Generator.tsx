'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  generatePassword, generatePassphrase, generateUsername, generatePin,
  scorePassword, type GeneratorOptions,
} from '@/lib/generator'
import { copyWithAutoClear } from '@/lib/clipboard'
import { CheckIcon, CopyIcon, RefreshIcon, WarningIcon } from '@/components/Icons'
import {
  CARD, ERROR_BANNER, PRIMARY_BUTTON, QUIET_BUTTON,
  SEGMENT, SEGMENTED, SEGMENT_OFF, SEGMENT_ON, STRENGTH_BAR,
} from '@/components/ui'

const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
}

type Mode = 'password' | 'passphrase' | 'username' | 'pin'

const MODES: { id: Mode; label: string }[] = [
  { id: 'password',   label: 'Password'   },
  { id: 'passphrase', label: 'Passphrase' },
  { id: 'username',   label: 'Username'   },
  { id: 'pin',        label: 'PIN'        },
]

export default function Generator() {
  const [mode, setMode]           = useState<Mode>('password')
  const [options, setOptions]     = useState<GeneratorOptions>(DEFAULT_OPTIONS)
  const [wordCount, setWordCount] = useState(6)
  const [pinLength, setPinLength] = useState(4)
  const [generated, setGenerated] = useState('')
  const [copied, setCopied]       = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [genError, setGenError]   = useState<string | null>(null)

  const regenerate = useCallback(() => {
    setGenError(null)
    setCopyError(false)
    try {
      if (mode === 'passphrase') setGenerated(generatePassphrase(wordCount))
      else if (mode === 'username') setGenerated(generateUsername())
      else if (mode === 'pin') setGenerated(generatePin(pinLength))
      else setGenerated(generatePassword(options))
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Generation failed')
      setGenerated('')
    }
  }, [mode, options, wordCount, pinLength])

  useEffect(() => { regenerate() }, [regenerate])

  const strength = mode === 'password' && generated ? scorePassword(generated) : null

  async function handleCopy() {
    if (!generated) return
    setCopyError(false)
    try {
      // Through lib/clipboard.ts like every other copy (CLAUDE.md): the 30s clear
      // is retried when the window gets focus back, and lock() clears it at once.
      // A bare setTimeout here used to fail silently once you'd switched apps (3.5)
      await copyWithAutoClear(generated)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
    }
  }

  function setOption<K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]) {
    setOptions(prev => ({ ...prev, [key]: value }))
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-primary text-xl font-semibold mb-1">
          Password <span className="font-serif italic font-normal">generator</span>
        </h2>
        <p className="text-slate-400 text-sm">
          All values generated using <code className="text-brand-600">crypto.getRandomValues()</code> — never Math.random().
        </p>
      </div>

      {/* Mode switch: the add/edit dialog's pill switch (3.3) */}
      <div className={SEGMENTED} role="group" aria-label="What to generate">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => setMode(m.id)}
            className={`${SEGMENT} ${mode === m.id ? SEGMENT_ON : SEGMENT_OFF}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Output card */}
      <div className={`${CARD} space-y-5`}>
        {genError ? (
          <div className={ERROR_BANNER} role="alert">
            <WarningIcon className="w-4 h-4 mt-0.5 flex-shrink-0 text-danger" />
            <span>{genError}</span>
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-950 border border-slate-700 px-5 py-6 min-h-[88px] flex items-center">
            <span className={`flex-1 font-mono break-all leading-relaxed select-all text-primary ${
              mode === 'pin' ? 'tracking-[0.4em] text-2xl text-center w-full' : 'text-lg'
            }`}>
              {generated || '—'}
            </span>
          </div>
        )}

        {/* Strength meter — password mode only. Same quarter-step scale as the
            Vault tab and the create-vault screen (3.3); the score stays in the label */}
        {strength && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Strength</span>
              <span className="text-slate-300 font-medium">
                {strength.label.charAt(0).toUpperCase() + strength.label.slice(1)} · {strength.score}/100
              </span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${STRENGTH_BAR[strength.label]}`} />
            </div>
          </div>
        )}

        {/* Entropy note — passphrase mode */}
        {mode === 'passphrase' && (
          <p className="text-slate-500 text-xs">
            {wordCount} words × 8 bits/word = ~{wordCount * 8} bits of entropy
            {wordCount >= 6 ? ' (good)' : ' (consider more words)'}
          </p>
        )}

        {/* Info note — username mode */}
        {mode === 'username' && (
          <p className="text-slate-500 text-xs">
            Format: adjective_nounNumber. Good for accounts where you don&apos;t want to use your real name.
          </p>
        )}

        {/* Info note — PIN mode */}
        {mode === 'pin' && (
          <p className="text-slate-500 text-xs">
            {pinLength}-digit cryptographically random PIN. Never share your PIN.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3">
          <button onClick={regenerate} className={`${QUIET_BUTTON} flex-[1_1_9rem]`}>
            <RefreshIcon className="w-4 h-4" />
            Regenerate
          </button>
          <button
            onClick={handleCopy}
            disabled={!generated || !!genError}
            className={`${PRIMARY_BUTTON} flex-[1_1_9rem]`}
          >
            {copied
              ? <><CheckIcon className="w-4 h-4" /> Copied</>
              : <><CopyIcon className="w-4 h-4" /> Copy</>}
          </button>
        </div>
        {copyError ? (
          <p className="text-slate-400 text-xs text-center flex items-center justify-center gap-1.5" role="alert">
            <WarningIcon className="w-3.5 h-3.5 text-danger" />
            Couldn&apos;t copy. Click the window and try again.
          </p>
        ) : (
          <p className="text-slate-500 text-xs text-center">Clipboard auto-clears after 30 seconds.</p>
        )}
      </div>

      {/* Options panel */}
      {mode !== 'username' && (
        <div className={`${CARD} space-y-5`}>
          <h3 className="text-primary font-medium text-sm">Options</h3>

          {mode === 'password' && (
            <>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Length</span>
                  <span className="text-primary font-mono font-medium">{options.length}</span>
                </div>
                <input
                  type="range" min={12} max={64} value={options.length}
                  onChange={e => setOption('length', Number(e.target.value))}
                  aria-label="Length"
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-slate-500">
                  <span>12</span><span>64</span>
                </div>
              </div>

              <div className="rounded-2xl bg-slate-950 border border-slate-700 divide-y divide-slate-700">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 p-4">
                  {([
                    ['uppercase', 'Uppercase (A–Z)'],
                    ['lowercase', 'Lowercase (a–z)'],
                    ['numbers',   'Numbers (0–9)'],
                    ['symbols',   'Symbols (!@#…)'],
                  ] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={options[key] as boolean}
                        onChange={e => setOption(key, e.target.checked)}
                        className="w-4 h-4 rounded accent-brand-500"
                      />
                      <span className="text-sm text-slate-400 group-hover:text-primary transition-colors">
                        {label}
                      </span>
                    </label>
                  ))}
                </div>
                <label className="flex items-center gap-2.5 cursor-pointer group p-4">
                  <input
                    type="checkbox"
                    checked={options.excludeAmbiguous}
                    onChange={e => setOption('excludeAmbiguous', e.target.checked)}
                    className="w-4 h-4 rounded accent-brand-500"
                  />
                  <span className="text-sm text-slate-400 group-hover:text-primary transition-colors">
                    Exclude ambiguous characters (0, O, 1, l, I)
                  </span>
                </label>
              </div>
            </>
          )}

          {mode === 'passphrase' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Word count</span>
                <span className="text-primary font-mono font-medium">{wordCount}</span>
              </div>
              <input
                type="range" min={3} max={8} value={wordCount}
                onChange={e => setWordCount(Number(e.target.value))}
                aria-label="Word count"
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>3 words</span><span>8 words</span>
              </div>
              <p className="text-slate-500 text-xs pt-1">
                Words separated by hyphens. Example: <span className="text-slate-400 font-mono">calm-bird-grow-fuel-loud-mine</span>
              </p>
            </div>
          )}

          {mode === 'pin' && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">PIN length</span>
                <span className="text-primary font-mono font-medium">{pinLength} digits</span>
              </div>
              <input
                type="range" min={4} max={8} value={pinLength}
                onChange={e => setPinLength(Number(e.target.value))}
                aria-label="PIN length"
                className="w-full accent-brand-500"
              />
              <div className="flex justify-between text-xs text-slate-500">
                <span>4 digits</span><span>8 digits</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
