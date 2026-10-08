// Skirmish any-vs-any picker (M5): up to four 'Mechs per side from every 'Mech in the data, a variant dropdown per chassis
// ("(stock)" labels and base BV), pilot skills per 'Mech (default 4/5), the adjusted BV of each pick and the side total.
// Names, tonnage and BV are data lookups; the BV skill multiplier comes from the data tables.
import {
  MAX_PICKS, SKILL_CHOICES, addPick, formatBv, mechOf, pickBv, removePick, setChassis, setPick, sideTotal, variantLabel,
  type Side, type StartCatalogue, type StartForm,
} from './startOptions'

export interface SkirmishPickerProps {
  side: Side
  form: StartForm
  cat: StartCatalogue
  onChange(f: StartForm): void
}

export function SkirmishPicker({ side, form, cat, onChange }: SkirmishPickerProps) {
  const picks = form.picks[side === 'A' ? 0 : 1]
  const total = sideTotal(cat, picks)
  const id = (n: number, what: string) => `pick-${side}-${n}-${what}`
  return (
    <div className="pick" data-testid={`pick-${side}`}>
      <ol className="pick-list">
        {picks.map((p, n) => {
          const m = mechOf(cat, p.mech)
          const group = cat.chassis.find((c) => c.chassis === m?.chassis)
          return (
            <li key={n} className="pick-row" data-testid={id(n, 'row')}>
              <select aria-label={`'Mech ${n + 1} chassis`} data-testid={id(n, 'chassis')} value={m?.chassis ?? ''}
                onChange={(e) => onChange(setChassis(form, cat, side, n, e.target.value))}>
                {cat.chassis.map((c) => <option key={c.chassis} value={c.chassis}>{c.chassis}</option>)}
              </select>
              <select aria-label={`'Mech ${n + 1} variant`} data-testid={id(n, 'variant')} value={p.mech}
                onChange={(e) => onChange(setPick(form, side, n, { mech: e.target.value }))}>
                {(group?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{`${variantLabel(v)} · BV ${formatBv(v.bv)}`}</option>)}
              </select>
              <label className="pick-skill" title="Gunnery skill (lower is better)">G
                <select aria-label={`'Mech ${n + 1} gunnery`} data-testid={id(n, 'gunnery')} value={p.gunnery}
                  onChange={(e) => onChange(setPick(form, side, n, { gunnery: Number(e.target.value) }))}>
                  {SKILL_CHOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="pick-skill" title="Piloting skill (lower is better)">P
                <select aria-label={`'Mech ${n + 1} piloting`} data-testid={id(n, 'piloting')} value={p.piloting}
                  onChange={(e) => onChange(setPick(form, side, n, { piloting: Number(e.target.value) }))}>
                  {SKILL_CHOICES.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <span className="pick-bv" data-testid={id(n, 'bv')} title={m ? `${m.tonnage} t, base BV ${formatBv(m.bv)}` : undefined}>
                {m ? `${m.tonnage} t · BV ${formatBv(pickBv(cat, p))}` : ''}
              </span>
              <button type="button" className="pick-remove" data-testid={id(n, 'remove')} aria-label={`Remove 'Mech ${n + 1}`}
                disabled={picks.length <= 1} onClick={() => onChange(removePick(form, side, n))}>×</button>
            </li>
          )
        })}
      </ol>
      <div className="pick-foot">
        <button type="button" className="pick-add" data-testid={`pick-${side}-add`} disabled={picks.length >= MAX_PICKS}
          onClick={() => onChange(addPick(form, cat, side))}>+ Add 'Mech</button>
        <span className="start-total" data-testid={`pick-${side}-total`}>
          {total.count} 'Mech{total.count === 1 ? '' : 's'} · {total.tonnage} t · BV {formatBv(total.bv)}
        </span>
      </div>
    </div>
  )
}
