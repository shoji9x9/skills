// eval の fixture（evals/*/fixtures/**）が import する、このリポジトリに無いモジュール。
// fixture はエージェントに渡す下流のプロジェクトの断片で、依存のパッケージと同じ階層のファイルを置いていない。
// 型は fixture が使う範囲だけを書く。fixture に import を足したら、ここにも足す。
// 雛形の宣言（types/parity-templates.d.ts）とは分ける。同じプロジェクトに入れると、互いの検査で一致してしまう。

// 市販のデータグリッド（current-environment-bootstrap の fixture。版は fixture の package.json にある）
declare module "@progress/kendo-react-grid" {
  import type { ComponentType, ReactNode } from "react";
  export const Grid: ComponentType<{
    data?: readonly unknown[];
    sortable?: boolean;
    filterable?: boolean;
    children?: ReactNode;
  }>;
  export const GridColumn: ComponentType<{ field?: string; title?: string }>;
}

// 新側の UI ライブラリ（parity-component の fixture。架空のパッケージ）
declare module "@vendor/ui" {
  import type { ComponentType } from "react";
  export type VendorButtonApi = { setEnabled(enabled: boolean): void };
  export type VendorInitializedEvent = { api: VendorButtonApi; element: HTMLElement };
  export const VendorButton: ComponentType<{
    className?: string;
    text: string;
    onClick?: () => void;
    initialized?: (event: VendorInitializedEvent) => void;
  }>;
}

declare module "@vendor/keyboard" {
  export function bindEnterKey(element: HTMLElement, handler: () => void): () => void;
}

// parity-component の fixture の main.tsx が import する、fixture に置いていないアプリの本体。
// ファイルとして解決できる import には使われない（fixture に App.tsx を置くと、その型で検査される）。
// 末尾が /App で、ファイルが無い import は、どの fixture のものでもこの宣言に一致する
declare module "*/App" {
  import type { ComponentType } from "react";
  export const App: ComponentType;
}
