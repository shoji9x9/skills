import { SidebarSearch } from "../components/Sidebar/Search";

export function Settings() {
  return (
    <main>
      <aside>
        <SidebarSearch onChange={() => {}} />
      </aside>
      <label>
        通知を受け取る
        <input type="checkbox" role="switch" aria-label="通知の切り替え" />
      </label>
    </main>
  );
}
