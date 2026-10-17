import { newKeyValue } from '@core/factory'
import type { KeyValue } from '@core/types'

interface Props<T extends KeyValue> {
  rows: T[]
  onChange(rows: T[]): void
  /** Build a new row; defaults to a plain key/value. */
  make?: () => T
  keyPlaceholder?: string
  valuePlaceholder?: string
  /** Render a custom value cell (e.g. file picker for form-data). */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => React.ReactNode
  /** Extra cell rendered after the key (e.g. text/file selector). */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => React.ReactNode
  secretToggle?: boolean
}

/** Postman-style editable table: there is always one empty trailing row that becomes real once typed in. */
export function KeyValueTable<T extends KeyValue>({
  rows,
  onChange,
  make = () => newKeyValue() as T,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  renderValue,
  renderExtra
}: Props<T>): React.JSX.Element {
  const ghost = make()
  const all = [...rows, ghost]

  const update = (id: string, patch: Partial<T>): void => {
    if (id === ghost.id) onChange([...rows, { ...ghost, ...patch }])
    else onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <table className="kv">
      <thead>
        <tr>
          <th className="kv-check" />
          <th>Key</th>
          {renderExtra && <th className="kv-extra" />}
          <th>Value</th>
          <th className="kv-actions" />
        </tr>
      </thead>
      <tbody>
        {all.map((row) => {
          const isGhost = row.id === ghost.id
          const up = (p: Partial<T>): void => update(row.id, p)
          return (
            <tr key={row.id} className={!row.enabled && !isGhost ? 'disabled' : ''}>
              <td className="kv-check">
                {!isGhost && <input type="checkbox" checked={row.enabled} onChange={(e) => up({ enabled: e.target.checked } as Partial<T>)} />}
              </td>
              <td>
                <input className="cell" placeholder={keyPlaceholder} value={row.key} onChange={(e) => up({ key: e.target.value } as Partial<T>)} />
              </td>
              {renderExtra && <td className="kv-extra">{!isGhost && renderExtra(row, up)}</td>}
              <td>
                {renderValue && !isGhost ? (
                  renderValue(row, up)
                ) : (
                  <input className="cell" placeholder={valuePlaceholder} value={row.value} onChange={(e) => up({ value: e.target.value } as Partial<T>)} />
                )}
              </td>
              <td className="kv-actions">
                {!isGhost && (
                  <button className="icon-btn" title="Delete" onClick={() => onChange(rows.filter((r) => r.id !== row.id))}>
                    ✕
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
