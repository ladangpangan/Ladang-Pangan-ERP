import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef(({ className, type, value, ...props }, ref) => {
  // Perbaikan UX: field angka bernilai 0 (number) tidak bisa di-backspace karena
  // controlled value memaksa "0" muncul lagi. Tampilkan 0 sebagai kosong agar bisa
  // dihapus & diketik ulang; gunakan placeholder untuk menampilkan 0 bila perlu.
  const displayValue = (type === 'number' && value === 0) ? '' : value;
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      value={displayValue}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
