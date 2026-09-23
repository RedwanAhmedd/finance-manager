import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RadarPanel from '../src/radar/RadarPanel'
const renderers: ReactTestRenderer[] = []
afterEach(() => {renderers.splice(0).forEach(r => r.unmount()); vi.unstubAllGlobals()})
const snapshot = {version:'5.2', fetchedAt:'2026-09-23T14:00:00Z', status:'ready', journalExists:true, reason:'Review your entry', runCount:1, owned:[], issues:[], benchmark:null, candidates:[{ savedAt:'2026-09-23T14:00:00Z', entryPriceCad:20, priceSide:'ask', priceEvidence:[{asOf:'2026-09-23T13:59:00Z',sourceUrl:'https://example.com/quote'}], evaluation:{evaluatedAt:'2026-09-23T14:00:00Z'}, decision:{symbol:'FICTIONAL.NE',action:'BUY',amountCad:500,reason:'Fictional reviewed evidence',blockers:[],thesis:'INTACT',opportunity:'BUY',allocation:'READY'}}]}
describe('Radar display lifecycle', () => {
  it('clears a prior actionable result when the next source read fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ok:true,json:async()=>snapshot}).mockResolvedValueOnce({ok:false,json:async()=>({error:'Journal integrity failed'})})
    vi.stubGlobal('fetch',fetch)
    let renderer!: ReactTestRenderer
    await act(async()=>{renderer=create(createElement(RadarPanel));renderers.push(renderer)})
    expect(JSON.stringify(renderer.toJSON())).toContain('FICTIONAL.NE')
    expect(JSON.stringify(renderer.toJSON())).toContain(new Date('2026-09-23T13:59:00Z').toLocaleString())
    expect(renderer.root.findAllByType('a')[0].props.href).toBe('https://example.com/quote')
    const refresh = renderer.root.findAllByType('button').find(b=>b.children.includes('Refresh Radar'))!
    await act(async()=>{await refresh.props.onClick()})
    expect(JSON.stringify(renderer.toJSON())).not.toContain('FICTIONAL.NE')
    expect(JSON.stringify(renderer.toJSON())).toContain('WAIT')
    expect(JSON.stringify(renderer.toJSON())).toContain('Journal integrity failed')
  })
})
