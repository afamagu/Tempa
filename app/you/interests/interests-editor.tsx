'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setProfileInterests } from '@/lib/profile-interests'
import { INTEREST_TAXONOMY, MIN_RECOMMENDED_INTERESTS, MAX_INTERESTS } from '@/lib/interests'
import ChoiceGroup from '@/app/profile/choice-group'
import { helperTextClass } from '@/app/profile/ui'

/**
 * Onboarding's own "What do you love reading about?" chip picker,
 * reused as-is (same ChoiceGroup, same cap behavior) — this component
 * only adds the explicit Save action and current-selection state an
 * edit-later surface needs that a one-shot onboarding form doesn't.
 */
export default function InterestsEditor({ initialSelectedKeys }: { initialSelectedKeys: string[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>(initialSelectedKeys)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(key: string) {
    setSaved(false)
    setSelected((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      if (prev.length >= MAX_INTERESTS) return prev
      return [...prev, key]
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()
    const { error: saveError } = await setProfileInterests(supabase, selected)
    setSaving(false)
    if (saveError) {
      setError('Could not save right now. Please try again.')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className={helperTextClass}>
          Pick a few ({MIN_RECOMMENDED_INTERESTS}+ works best, up to {MAX_INTERESTS}).
        </p>
        <ChoiceGroup
          ariaLabel="What do you love reading about?"
          options={INTEREST_TAXONOMY.map((i) => ({ value: i.key, label: i.label }))}
          selected={selected}
          onToggle={toggle}
          layout="pill"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-accent text-accent-foreground px-4 py-2.5 text-[15px] font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !saving && <p className={helperTextClass}>Saved.</p>}
      </div>
    </div>
  )
}
