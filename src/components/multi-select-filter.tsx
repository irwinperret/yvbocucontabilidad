import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Filter } from "lucide-react";

export type OptionItem = { value: string; label: string };

export function MultiSelectFilter({
  options, groupedOptions, selected, onChange, label,
}: {
  options?: OptionItem[];
  groupedOptions?: { group: string; items: OptionItem[] }[];
  selected: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  const active = selected.length > 0;
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter((x) => x !== val) : [...selected, val]);
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted ${active ? "text-primary" : "text-muted-foreground"}`}
          aria-label="Filtrar"
        >
          <Filter className="h-3 w-3" />
          {active && <span className="text-[10px] ml-0.5">{selected.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2 pointer-events-auto" align="start">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">{label}</Label>
          {active && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onChange([])}>Limpiar</Button>
          )}
        </div>
        <ScrollArea className="h-64">
          <div className="space-y-1 pr-2">
            {options?.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
            {groupedOptions?.map((g) => (
              <div key={g.group}>
                <div className="text-[10px] uppercase text-muted-foreground mt-2 mb-0.5 px-1">{g.group}</div>
                {g.items.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                    <Checkbox checked={selected.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                    <span className="truncate">{o.label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
