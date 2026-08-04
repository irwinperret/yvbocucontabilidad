import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type ComboOption = { value: string; label: string; keywords?: string };

/** Combobox con búsqueda (typeahead) para listas largas. */
export function SearchCombobox({
  options,
  value,
  onChange,
  placeholder = "Seleccionar",
  searchPlaceholder = "Buscar...",
  emptyText = "Sin resultados",
  className,
  triggerClassName,
  disabled,
  maxRender = 60,
}: {
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
  maxRender?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const filtered = (q
    ? options.filter((o) => (o.label + " " + (o.keywords ?? "")).toLowerCase().includes(q))
    : options
  ).slice(0, maxRender);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("justify-between font-normal text-xs h-8", triggerClassName)}
        >
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[320px] p-0", className)} align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__none__"
                onSelect={() => { onChange(null); setOpen(false); setQuery(""); }}
              >
                <Check className={cn("mr-2 h-3 w-3", !value ? "opacity-100" : "opacity-0")} />
                — Sin seleccionar —
              </CommandItem>
              {filtered.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  onSelect={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                >
                  <Check className={cn("mr-2 h-3 w-3", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
