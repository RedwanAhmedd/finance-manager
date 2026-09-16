import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSnapshot } from '../src/live/useSnapshot'

type Snapshot = { balance: number }
type Adapter = {getSnapshot(): Promise<Snapshot>}
const renderers: ReactTestRenderer[] = []
let refresh: () => void
function Harness({user,adapter}: {user: string | null; adapter: Adapter}) {
  const result=useSnapshot(user,adapter)
  refresh=result.refresh
  return createElement('output',null,JSON.stringify({data:result.data,error:result.error,loading:result.loading}))
}
function read(renderer: ReactTestRenderer) {
  return JSON.parse(renderer.root.findByType('output').children.join(''))
}
function deferred() {
  let resolve!: (value: Snapshot) => void
  let reject!: (reason: Error) => void
  const promise=new Promise<Snapshot>((res,rej)=>{resolve=res;reject=rej})
  return {promise,resolve,reject}
}
afterEach(()=>{act(()=>{renderers.splice(0).forEach(r=>r.unmount())})})

describe('Financial snapshot lifecycle',()=>{
  it('clears real figures on sign-out', async()=>{
    const adapter={getSnapshot:vi.fn().mockResolvedValue({balance:100})}
    let renderer!: ReactTestRenderer
    await act(async()=>{renderer=create(createElement(Harness,{user:'A',adapter}));renderers.push(renderer)})
    expect(read(renderer).data).toEqual({balance:100})
    await act(async()=>{renderer.update(createElement(Harness,{user:null,adapter}))})
    expect(read(renderer).data).toBeNull()
    expect(adapter.getSnapshot).toHaveBeenCalledTimes(1)
  })
  it('discards a late response from the previous account', async()=>{
    const first=deferred(),second=deferred()
    const adapter={getSnapshot:vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)}
    let renderer!: ReactTestRenderer
    await act(async()=>{renderer=create(createElement(Harness,{user:'A',adapter}));renderers.push(renderer)})
    await act(async()=>{renderer.update(createElement(Harness,{user:'B',adapter}))})
    await act(async()=>{second.resolve({balance:200})})
    await act(async()=>{first.resolve({balance:100})})
    expect(read(renderer).data).toEqual({balance:200})
  })
  it('removes the previous balance while refreshing and leaves it cleared on failure', async()=>{
    const next=deferred()
    const adapter={getSnapshot:vi.fn().mockResolvedValueOnce({balance:100}).mockReturnValueOnce(next.promise)}
    let renderer!: ReactTestRenderer
    await act(async()=>{renderer=create(createElement(Harness,{user:'A',adapter}));renderers.push(renderer)})
    await act(async()=>{refresh()})
    expect(read(renderer).data).toBeNull()
    expect(read(renderer).loading).toBe(true)
    await act(async()=>{next.reject(new Error('Connection lost'))})
    expect(read(renderer).data).toBeNull()
    expect(read(renderer).error).toContain('Connection lost')
  })
  it('does not begin a read before source sign-in', async()=>{
    const adapter={getSnapshot:vi.fn().mockResolvedValue({balance:100})}
    await act(async()=>{renderers.push(create(createElement(Harness,{user:null,adapter})))})
    expect(adapter.getSnapshot).not.toHaveBeenCalled()
  })
})
