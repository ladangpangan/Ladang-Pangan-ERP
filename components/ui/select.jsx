"use client"

import * as React from "react"
import * as SelectPrimitive from "@radix-ui/react-select"
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react"

import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

const SelectGroup = SelectPrimitive.Group

const SelectValue = SelectPrimitive.Value

const SelectTrigger = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className
    )}
    {...props}>
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
))
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName

const SelectScrollUpButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
))
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName

const SelectScrollDownButton = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}>
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
))
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName

const SelectContent = React.forwardRef(({ className, children, position = "popper", ...props }, ref) => {
  const [q, setQ] = React.useState("");
  const query = q.trim().toLowerCase();

  // Ekstrak teks yang bisa dicari dari sebuah <SelectItem>
  const itemText = (el) => {
    const c = el?.props?.children;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.filter((x) => typeof x === "string").join(" ");
    return String(el?.props?.value ?? "");
  };

  // Hitung total item (termasuk di dalam SelectGroup) untuk memutuskan tampil-tidaknya kotak search
  let itemCount = 0;
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (child.type === SelectItem) itemCount++;
    else if (child.type === SelectGroup) {
      React.Children.forEach(child.props.children, (gc) => {
        if (React.isValidElement(gc) && gc.type === SelectItem) itemCount++;
      });
    }
  });
  const showSearch = itemCount >= 8;

  const matches = (el) => !query || itemText(el).toLowerCase().includes(query);

  // Filter anak-anak berdasarkan query (mendukung SelectGroup satu tingkat)
  const filterChildren = (nodes) =>
    React.Children.toArray(nodes)
      .map((child) => {
        if (!React.isValidElement(child)) return child;
        if (child.type === SelectItem) return matches(child) ? child : null;
        if (child.type === SelectGroup) {
          const inner = React.Children.toArray(child.props.children).filter((gc) => {
            if (React.isValidElement(gc) && gc.type === SelectItem) return matches(gc);
            return true; // pertahankan label/separator
          });
          const hasItem = inner.some((gc) => React.isValidElement(gc) && gc.type === SelectItem);
          return hasItem ? React.cloneElement(child, {}, inner) : null;
        }
        return child; // separator, label lepas, dll.
      })
      .filter(Boolean);

  const filtered = showSearch ? filterChildren(children) : children;
  const hasResult = React.Children.toArray(filtered).some(
    (c) => React.isValidElement(c) && (c.type === SelectItem || c.type === SelectGroup)
  );

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-select-content-transform-origin]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}>
        <SelectScrollUpButton />
        {showSearch && (
          <div className="sticky top-0 z-10 bg-popover p-1 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // Biarkan karakter & backspace mengetik ke input (jangan diambil typeahead Radix);
                // panah/enter/escape tetap diteruskan ke Radix untuk navigasi & pilih.
                onKeyDown={(e) => { if (e.key.length === 1 || e.key === "Backspace") e.stopPropagation(); }}
                placeholder="Cari..."
                className="w-full h-8 pl-7 pr-2 text-sm rounded-sm border border-input bg-transparent outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
        )}
        <SelectPrimitive.Viewport
          className={cn("p-1", position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]")}>
          {filtered}
          {showSearch && !hasResult && (
            <div className="py-4 text-center text-sm text-muted-foreground">Tidak ada hasil</div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
})
SelectContent.displayName = SelectPrimitive.Content.displayName

const SelectLabel = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", className)}
    {...props} />
))
SelectLabel.displayName = SelectPrimitive.Label.displayName

const SelectItem = React.forwardRef(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}>
    <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
))
SelectItem.displayName = SelectPrimitive.Item.displayName

const SelectSeparator = React.forwardRef(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props} />
))
SelectSeparator.displayName = SelectPrimitive.Separator.displayName

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
