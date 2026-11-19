export function SidebarSearch({ onChange }: { onChange: (q: string) => void }) {
  return <input aria-label="ノートを検索" onChange={(e) => onChange(e.target.value)} />;
}
