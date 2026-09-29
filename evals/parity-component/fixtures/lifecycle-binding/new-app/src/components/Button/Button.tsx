import { useEffect, useRef } from "react";
import { VendorButton, type VendorButtonApi, type VendorInitializedEvent } from "@vendor/ui";
import { bindEnterKey } from "@vendor/keyboard";

export type ButtonProps = {
  variant: "primary" | "secondary";
  label: string;
  disabled?: boolean;
  onClick?: () => void;
};

export function Button({ variant, label, disabled = false, onClick }: ButtonProps) {
  const api = useRef<VendorButtonApi | null>(null);
  const unbindEnter = useRef<(() => void) | null>(null);

  // 市販部品の初期化が済んだら、フォーカス中の Enter キーで押せるようにし、活性・不活性を反映する。
  const handleInitialized = (event: VendorInitializedEvent) => {
    api.current = event.api;
    unbindEnter.current = bindEnterKey(event.element, () => onClick?.());
    event.api.setEnabled(!disabled);
  };

  // 外すときに Enter キーの結び付けを片付ける。
  useEffect(() => {
    return () => {
      unbindEnter.current?.();
      unbindEnter.current = null;
      api.current = null;
    };
  }, []);

  return (
    <VendorButton
      className={`btn btn-${variant}`}
      text={label}
      onClick={onClick}
      initialized={handleInitialized}
    />
  );
}
