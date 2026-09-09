import { helperTextClass, sectionLabelClass } from '@/app/profile/ui'
import { POSTCARD_CATALOG, type PostcardData } from '@/lib/moments'

/**
 * Tempa's own postcard catalog — never the device photo library. This
 * checkpoint's catalog is a single Featured card, but the section
 * architecture (Featured / My Postcards / Places / Collections) is
 * built out now so a real catalog, ownership, and — later, separately —
 * a paid tier can slot in without a picker redesign. No currency/store
 * logic exists yet; every section below is either populated from the
 * static catalog or an honest "nothing here yet" placeholder.
 */
function PickerSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <p className={sectionLabelClass}>{title}</p>
      {children}
    </div>
  )
}

function PostcardCard({
  postcard,
  onSelect,
}: {
  postcard: PostcardData
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-28 shrink-0 flex-col items-start gap-1 rounded-md border border-foreground/15 p-2 text-left transition-colors hover:border-accent"
    >
      <img
        src={postcard.frontImagePath}
        alt=""
        className="h-16 w-full rounded object-cover"
      />
      <span className="truncate text-[12px] font-medium text-foreground">{postcard.title}</span>
      <span className="truncate text-[11px] text-muted">{postcard.location}</span>
    </button>
  )
}

export default function PostcardPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (postcardKey: string) => void
  onCancel: () => void
}) {
  const featured = Object.entries(POSTCARD_CATALOG)

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 rounded-md border border-foreground/10 p-4">
      <PickerSection title="Featured">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {featured.map(([key, postcard]) => (
            <PostcardCard key={key} postcard={postcard} onSelect={() => onSelect(key)} />
          ))}
        </div>
      </PickerSection>

      <PickerSection title="My Postcards">
        <p className={helperTextClass}>You don&apos;t have any Postcards yet.</p>
      </PickerSection>

      <PickerSection title="Places">
        <p className={helperTextClass}>More coming soon.</p>
      </PickerSection>

      <PickerSection title="Collections">
        <p className={helperTextClass}>More coming soon.</p>
      </PickerSection>

      <button type="button" onClick={onCancel} className={helperTextClass}>
        Cancel
      </button>
    </div>
  )
}
