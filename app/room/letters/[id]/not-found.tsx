import Link from 'next/link'

export default function LetterNotFound() {
  return <main className="mx-auto max-w-md px-6 py-20 text-center">
    <h1 className="font-serif text-2xl">This letter isn’t available.</h1>
    <p className="mt-3 text-sm text-foreground/70">It may have been withdrawn or become unavailable.</p>
    <Link href="/room" className="mt-6 inline-block text-sm underline underline-offset-4">Back to The Room</Link>
  </main>
}
