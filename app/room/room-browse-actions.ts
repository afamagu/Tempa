'use server'

import { createClient } from '@/lib/supabase/server'
import { getBoardFeedPage, type BoardFeedCursor } from '@/lib/dispatches'
import { getEditorialBylines, editorialTitleFor } from '@/lib/editorial-byline'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An authenticated source of bounded, already-authorized public writing. */
export async function loadRoomLetterWindow(args:{
  startedAt:string
  seed:string
  cursor:BoardFeedCursor|null
}){
  const supabase=await createClient()
  const {data:{user}}=await supabase.auth.getUser()
  if(!user)return {items:[],nextCursor:null,error:'Please sign in again.'}
  if(!args||typeof args!=='object'||!Number.isFinite(Date.parse(args.startedAt))||
    args.startedAt.length>40||typeof args.seed!=='string'||!/^[a-z0-9]{1,20}$/.test(args.seed)||
    (args.cursor && (!UUID.test(args.cursor.id)||!/^-?\d{1,28}(\.\d{1,28})?$/.test(args.cursor.rankKey)||
       !Number.isSafeInteger(args.cursor.seedHash)||!Number.isInteger(args.cursor.seenBucket)))){
    return {items:[],nextCursor:null,error:'The browsing session is no longer valid. Refresh The Board.'}
  }
  try{
    const {items,nextCursor}=await getBoardFeedPage(supabase,{
      sessionStartedAt:args.startedAt,
      seed:args.seed,
      cursor:args.cursor,
      limit:48,
    })
    // The service already applies RLS, but the member-authored condition is
    // repeated here so no official/sponsored content enters the new Room UI.
    const houseBylines=await getEditorialBylines(supabase)
    const visible=items.filter(x=>x.publishedAs==='member'&&x.authorId!==user.id&&!editorialTitleFor(houseBylines,x.authorPseudonym))
    const ids=[...new Set(visible.map(item=>item.authorId))]
    const profiles=ids.length
      ? await supabase.from('public_profiles').select('id, gender, gender_custom, age_range').in('id',ids)
      : {data:[]}
    const authorDetails=Object.fromEntries((profiles.data??[]).map(profile=>[profile.id,{
      gender:profile.gender,genderCustom:profile.gender_custom,ageRange:profile.age_range,
    }]))
    return {items:visible,nextCursor,error:null,authorDetails}
  }catch(error){
    console.error('[room] next window failed',error)
    return {items:[],nextCursor:null,error:'Could not find more letters. Please try again.'}
  }
}
