import { ROOM_LETTER_BATCH_SIZE, type RoomLetterCandidate } from './room-letter-selection'

export function nextRoomLetters<T extends RoomLetterCandidate>(
  pool: readonly T[],
  viewerId: string,
  previousIds: ReadonlySet<string>,
  previousAuthors: ReadonlySet<string>,
): { added: T[]; remaining: T[] } {
  const eligible = pool.filter(x=>x.publishedAs==='member' && x.authorId!==viewerId && !previousIds.has(x.id))
  const seenAuthor = new Set<string>()
  const usedIds = new Set<string>()
  const added:T[]=[]
  const preferred = [
    ...eligible.filter(x=>!previousAuthors.has(x.authorId)),
    ...eligible.filter(x=>previousAuthors.has(x.authorId)),
  ]
  for(const personLetter of preferred){
    if(added.length>=ROOM_LETTER_BATCH_SIZE)break
    if(usedIds.has(personLetter.id)||seenAuthor.has(personLetter.authorId))continue
    added.push(personLetter)
    usedIds.add(personLetter.id)
    seenAuthor.add(personLetter.authorId)
  }
  return {
    added,
    remaining: eligible.filter(x=>!usedIds.has(x.id)),
  }
}
