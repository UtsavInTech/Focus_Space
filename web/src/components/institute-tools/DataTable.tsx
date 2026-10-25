import type { Row } from '../../institute-api';

/** A plain table of API rows; the columns are whatever the server returned, in its order. */
export function DataTable({ rows }: { rows: Row[] }) {
  if (!rows.length) return <p>No matching records.</p>;
  const keys = Object.keys(rows[0]);
  return (
    <div className="fsw-tool-table">
      <table>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key} scope="col">
                {key.replaceAll('_', ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {keys.map((key) => (
                <td key={key}>{row[key] === null ? '—' : String(row[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
