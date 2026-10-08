'use client'

import type { RefObject } from 'react'

export default function VideoSourceInput({
  inputRef,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="video/mp4,video/webm,video/quicktime"
      onChange={onChange}
      className="hidden"
    />
  )
}
