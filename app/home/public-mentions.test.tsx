import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PublicMentions from './public-mentions'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc})}))
vi.mock('next-intl/server',()=>({getTranslations:async()=> (key:string,args?:{name:string})=>args?`${args.name} mentioned you`:key}))
it('keeps home notices unread-only, finite and linked to their exact event',async()=>{
 rpc.mockResolvedValue({data:[1,2,3,4].map(id=>({id:String(id),kind:'dispatch',pseudonym:'Mia',read_at:null})),error:null})
 const html=renderToStaticMarkup(await PublicMentions({}))
 expect(rpc).toHaveBeenCalledWith('get_public_mentions',{p_offset:0,p_unread_only:true})
 expect(html).toContain('/mentions/1');expect(html).toContain('/mentions/3');expect(html).not.toContain('/mentions/4')
 expect(html).toContain('/you/mentions');expect(html).toContain('noticeTitle')
})
it('does not render an empty home notice',async()=>{
 rpc.mockResolvedValue({data:[],error:null})
 expect(await PublicMentions({})).toBeNull()
})
it('retains history pagination separately from the home notice',async()=>{
 rpc.mockResolvedValue({data:Array.from({length:21},(_,id)=>({id:String(id),kind:'answer',pseudonym:'Mia',read_at:'read'})),error:null})
 const html=renderToStaticMarkup(await PublicMentions({history:true,offset:20}))
 expect(html).toContain('/you/mentions?offset=40');expect(html).toContain('/you/mentions?offset=0')
})
